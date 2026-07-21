// OB → Supabase sync (runs every 2h via .github/workflows/sync-supabase.yml).
// Loads the live dashboard (which already parses all sheets), reads window.allRows,
// aggregates line-items to one row per rooftop, then:
//   1. diffs the fresh state against ob_current (the last-known state) → writes change
//      events to ob_event (the Activity Log),
//   2. overwrites ob_current to mirror the sheet,
//   3. upserts today's row into ob_snapshot (daily history → Trends charts).
// Idempotent on (snapshot_date, row_key). Self-skips (exit 0) if Supabase env isn't set.
// Env: SNAPSHOT_URL (optional), SUPABASE_URL, SUPABASE_SERVICE_KEY
const { chromium } = require('playwright');

const URL = process.env.SNAPSHOT_URL || 'https://spyne-onboarding-dashboard.vercel.app/';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log('SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping sync.');
  process.exit(0);
}

// ── Supabase PostgREST helper ────────────────────────────────────────────────
async function sb(method, path, { body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  return res;
}
async function upsert(table, rows, conflict) {
  const CHUNK = 500;
  const prefer = conflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal';
  const q = conflict ? `?on_conflict=${conflict}` : '';   // no conflict target → plain append (ob_event)
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sb('POST', table + q, { body: rows.slice(i, i + CHUNK), prefer });
  }
}

// ── Diff helpers ──────────────────────────────────────────────────────────────
const cls = s => { const v = (s || '').trim(); return /^live/i.test(v) ? 'live' : /drop|churn/i.test(v) ? 'drop' : 'ob'; };
const norm = x => (x == null ? '' : String(x)).trim();
const dayDelta = (a, b) => {
  if (!a || !b) return null;
  const d = Math.round((new Date(b) - new Date(a)) / 86400000);
  return isNaN(d) ? null : (d >= 0 ? '+' : '') + d + ' days';
};
const money = n => Math.round(n || 0).toLocaleString('en-US');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(() => typeof allRows !== 'undefined' && allRows.length > 0, { timeout: 90000 });
  await page.waitForTimeout(1200);

  const rows = await page.evaluate(() => {
    const ymd = d => {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    };
    return allRows.map(r => ({
      row_key: (r.entId || '') + '|' + (r.rooftopName || r.entityName || '') + '|' + (r.source || ''),
      account: r.entityName || r.rooftopName || '',
      rooftop: r.rooftopName || '',
      source: r.source || '',
      product: r.product || '',
      ob_poc: r.obPoc || '',
      ae_name: r.ae || '',
      arr: r.arr || 0,
      stage: r.stage || '',
      sub_stage: r.subStage || '',
      current_month_conf: r.currentMonthConf || '',
      blocked_owner: r.blockedReason || '',
      blocked_remarks: r.blockedRemarks || '',
      projection_date: ymd(r.projectionDate),
      go_live_date: ymd(r.goLiveDate),
      drop_date: ymd(r.dropDate)
    }));
  });
  await browser.close();

  if (!rows.length) throw new Error('No rows read from dashboard — aborting.');

  // Merge sheet line-item duplicates (same rooftop, multiple product lines) into one row.
  const byKey = {};
  for (const r of rows) {
    const a = byKey[r.row_key] || (byKey[r.row_key] = { ...r, arr: 0 });
    a.arr += r.arr || 0;
    if (r.projection_date && (!a.projection_date || r.projection_date < a.projection_date)) a.projection_date = r.projection_date;
    if (r.go_live_date && (!a.go_live_date || r.go_live_date > a.go_live_date)) a.go_live_date = r.go_live_date;
    if (r.drop_date && (!a.drop_date || r.drop_date > a.drop_date)) a.drop_date = r.drop_date;
    for (const f of ['product', 'stage', 'sub_stage', 'current_month_conf', 'blocked_owner', 'blocked_remarks', 'ob_poc', 'ae_name']) {
      if (!a[f] && r[f]) a[f] = r[f];
    }
  }
  const fresh = Object.values(byKey).map(r => ({ ...r, arr: Math.round(r.arr) }));
  const freshKeys = new Set(fresh.map(r => r.row_key));

  // Last-known state (the diff base).
  const prevRows = await (await sb('GET', 'ob_current?select=*&limit=5000')).json();
  const prevMap = new Map(prevRows.map(r => [r.row_key, r]));

  // Safety: if the dashboard clearly under-loaded (a sheet fetch flaked), don't emit a flood
  // of false "removed_from_sheet" events or wipe the mirror — abort this run instead.
  if (prevMap.size > 20 && freshKeys.size < prevMap.size * 0.5) {
    throw new Error(`Fresh row count ${freshKeys.size} < 50% of previous ${prevMap.size} — suspected partial load, aborting.`);
  }

  // ── Build the activity-log events by diffing fresh vs prev ──
  const events = [];
  const evt = (r, type, field, oldV, newV, detail) => events.push({
    row_key: r.row_key, account: r.account || '', source: r.source || '', product: r.product || '',
    arr: Math.round(r.arr || 0), event_type: type, field: field || null,
    old_value: oldV == null ? null : String(oldV), new_value: newV == null ? null : String(newV),
    detail: detail || null
  });

  if (prevMap.size === 0) {
    console.log('ob_current is empty — seeding baseline, no events emitted this run.');
  } else {
    for (const f of fresh) {
      const p = prevMap.get(f.row_key);
      if (!p) {                                   // brand-new account
        const c = cls(f.stage);
        evt(f, c === 'live' ? 'went_live' : c === 'drop' ? 'dropped' : 'entered_ob', 'stage', null, f.stage, null);
        continue;
      }
      const pc = cls(p.stage), fc = cls(f.stage);
      if (pc !== fc) {                            // stage-class transition (the headline movements)
        const type = fc === 'live' ? 'went_live'
          : fc === 'drop' ? 'dropped'
          : pc === 'live' ? 'live_to_ob'
          : pc === 'drop' ? 'undropped'
          : 'entered_ob';
        evt(f, type, 'stage', p.stage, f.stage, `${norm(p.stage) || '—'} → ${norm(f.stage) || '—'}`);
        // still surface value moves that matter alongside a transition
        if (Math.round(p.arr || 0) !== f.arr) evt(f, 'arr_changed', 'arr', Math.round(p.arr || 0), f.arr, `${money(p.arr)} → ${money(f.arr)}`);
        if (norm(p.current_month_conf) !== norm(f.current_month_conf)) evt(f, 'confirmation_flip', 'current_month_conf', p.current_month_conf, f.current_month_conf, `${norm(p.current_month_conf) || '—'} → ${norm(f.current_month_conf) || '—'}`);
        continue;
      }
      // same stage-class → granular field changes
      if (norm(p.projection_date) !== norm(f.projection_date))
        evt(f, 'projection_moved', 'projection_date', p.projection_date, f.projection_date, dayDelta(p.projection_date, f.projection_date));
      if (norm(p.go_live_date) !== norm(f.go_live_date))
        evt(f, 'go_live_changed', 'go_live_date', p.go_live_date, f.go_live_date, dayDelta(p.go_live_date, f.go_live_date));
      if (Math.round(p.arr || 0) !== f.arr)
        evt(f, 'arr_changed', 'arr', Math.round(p.arr || 0), f.arr, `${money(p.arr)} → ${money(f.arr)}`);
      if (norm(p.current_month_conf) !== norm(f.current_month_conf))
        evt(f, 'confirmation_flip', 'current_month_conf', p.current_month_conf, f.current_month_conf, `${norm(p.current_month_conf) || '—'} → ${norm(f.current_month_conf) || '—'}`);
      if (norm(p.blocked_owner) !== norm(f.blocked_owner))
        evt(f, 'blocked_owner_changed', 'blocked_owner', p.blocked_owner, f.blocked_owner, `${norm(p.blocked_owner) || '—'} → ${norm(f.blocked_owner) || '—'}`);
      if (norm(p.sub_stage) !== norm(f.sub_stage))
        evt(f, 'sub_stage_changed', 'sub_stage', p.sub_stage, f.sub_stage, `${norm(p.sub_stage) || '—'} → ${norm(f.sub_stage) || '—'}`);
    }
    // accounts that vanished from the sheet
    for (const [k, p] of prevMap) {
      if (!freshKeys.has(k)) evt(p, 'removed_from_sheet', 'stage', p.stage, null, null);
    }
  }

  // ── Write: events first (never lose history), then mirror, then daily snapshot ──
  if (events.length) {
    await upsert('ob_event', events);           // append-only (no on_conflict → plain insert)
    console.log(`Logged ${events.length} activity event(s).`);
  } else {
    console.log('No changes detected.');
  }

  const now = new Date().toISOString();
  const curPayload = fresh.map(r => ({
    row_key: r.row_key, account: r.account || '', rooftop: r.rooftop || '', source: r.source || '',
    product: r.product || '', ob_poc: r.ob_poc || '', ae_name: r.ae_name || '', arr: r.arr,
    stage: r.stage || '', sub_stage: r.sub_stage || '', current_month_conf: r.current_month_conf || '',
    blocked_owner: r.blocked_owner || '', blocked_remarks: r.blocked_remarks || '',
    projection_date: r.projection_date, go_live_date: r.go_live_date, drop_date: r.drop_date, synced_at: now
  }));
  await upsert('ob_current', curPayload, 'row_key');
  // prune accounts no longer on the sheet so they aren't re-diffed forever
  const staleKeys = [...prevMap.keys()].filter(k => !freshKeys.has(k));
  for (const k of staleKeys) {
    await sb('DELETE', 'ob_current?row_key=eq.' + encodeURIComponent(k), { prefer: 'return=minimal' });
  }
  console.log(`Mirror ob_current: ${curPayload.length} accounts (${staleKeys.length} pruned).`);

  const today = now.slice(0, 10);
  const snapPayload = fresh.map(r => ({
    snapshot_date: today, row_key: r.row_key, account: r.account || '', rooftop: r.rooftop || '',
    source: r.source || '', ob_poc: r.ob_poc || '', ae_name: r.ae_name || '', arr: r.arr,
    stage: r.stage || '', sub_stage: r.sub_stage || '', current_month_conf: r.current_month_conf || '',
    blocked_owner: r.blocked_owner || '', blocked_remarks: r.blocked_remarks || '',
    projection_date: r.projection_date, go_live_date: r.go_live_date, drop_date: r.drop_date
  }));
  await upsert('ob_snapshot', snapPayload, 'snapshot_date,row_key');
  console.log(`Snapshot ${today}: ${snapPayload.length} accounts written to ob_snapshot.`);
})().catch(err => { console.error(err); process.exit(1); });
