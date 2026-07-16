// Daily OB snapshot → Supabase. Loads the live dashboard (which already parses all sheets),
// reads window.allRows, aggregates line-items to one row per rooftop, and upserts today's
// snapshot into ob_snapshot. Idempotent on (snapshot_date, row_key) so re-runs are safe.
// Self-skips (exit 0) if the Supabase env isn't set, so it never breaks the report workflow.
// Env: SNAPSHOT_URL (optional), SUPABASE_URL, SUPABASE_SERVICE_KEY
const { chromium } = require('playwright');

const URL = process.env.SNAPSHOT_URL || 'https://spyne-onboarding-dashboard.vercel.app/';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log('SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping snapshot.');
  process.exit(0);
}

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

  if (!rows.length) throw new Error('No rows read from dashboard — aborting (would wipe nothing, but nothing to write).');

  // Merge sheet line-item duplicates (same rooftop, multiple product lines) into one snapshot row.
  const byKey = {};
  for (const r of rows) {
    const a = byKey[r.row_key] || (byKey[r.row_key] = { ...r, arr: 0 });
    a.arr += r.arr || 0;
    if (r.projection_date && (!a.projection_date || r.projection_date < a.projection_date)) a.projection_date = r.projection_date;
    if (r.go_live_date && (!a.go_live_date || r.go_live_date > a.go_live_date)) a.go_live_date = r.go_live_date;
    if (r.drop_date && (!a.drop_date || r.drop_date > a.drop_date)) a.drop_date = r.drop_date;
    for (const f of ['stage', 'sub_stage', 'current_month_conf', 'blocked_owner', 'blocked_remarks', 'ob_poc', 'ae_name']) {
      if (!a[f] && r[f]) a[f] = r[f];
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const payload = Object.values(byKey).map(r => ({ snapshot_date: today, ...r, arr: Math.round(r.arr) }));

  const endpoint = SUPABASE_URL + '/rest/v1/ob_snapshot';
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const batch = payload.slice(i, i + CHUNK);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(batch)
    });
    if (!res.ok) throw new Error('Supabase upsert failed: HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 300));
    console.log(`Upserted ${i + batch.length}/${payload.length} rows.`);
  }
  console.log(`Snapshot ${today}: ${payload.length} accounts written to ob_snapshot.`);
})().catch(err => { console.error(err); process.exit(1); });
