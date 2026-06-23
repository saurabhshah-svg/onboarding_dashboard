// ============================================================
// SPYNE OB DASHBOARD — Google Apps Script
//   1) Data proxy for the dashboard  (doGet ?sheet=vini|amer|apac|churn)
//   2) Daily Slack report             (doGet ?action=slack  +  daily trigger)
// Deploy as Web App: Execute as "Me", Access "Anyone".
// IMPORTANT: set the project Time zone to (GMT+5:30) India  (Project Settings)
//            so "today / yesterday / this month" align with IST.
// ============================================================

const SPREADSHEET_ID = '1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0';
const GID_MAP = { vini: 2053683245, amer: 1134407178, apac: 764039413 };

// CS churn/contraction dashboard (separate spreadsheet)
const CHURN_SPREADSHEET_ID = '1H5cBuWmLD_roF_LV3foWII37PHbTqqNdzCcVGeAGU8A';
const CHURN_GID = 1421999984;

// Base ARR at end of last month (May'26), by product — mirrors the dashboard.
const BASE_LARR_BY_PRODUCT = { vini: 1098016, studio: 6634079 };

// ↓↓↓ PASTE YOUR SLACK INCOMING WEBHOOK URL HERE ↓↓↓
const SLACK_WEBHOOK_URL = '';   // e.g. https://hooks.slack.com/services/T000/B000/xxxx

// ─────────────────────────────────────────────────────────────
// Web app entry point
// ─────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'slack') {
      const r = sendSlackReport();
      return respond({ ok: true, slack: r });
    }

    const sheet = (e.parameter.sheet || 'vini').toLowerCase();
    let ssId, gid, useDisplay = false;
    if (sheet === 'churn') { ssId = CHURN_SPREADSHEET_ID; gid = CHURN_GID; useDisplay = true; }
    else { ssId = SPREADSHEET_ID; gid = GID_MAP[sheet]; }
    if (!gid) return respond({ error: 'Unknown sheet: ' + sheet });

    const ss = SpreadsheetApp.openById(ssId);
    const target = ss.getSheets().find(s => s.getSheetId() === gid);
    if (!target) return respond({ error: 'GID not found: ' + gid });

    const values = useDisplay ? target.getDataRange().getDisplayValues() : target.getDataRange().getValues();
    const csv = values.map(row => row.map(cell => {
      const s = String(cell === null || cell === undefined ? '' : cell);
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');

    return ContentService.createTextOutput(JSON.stringify({ csv, syncedAt: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────
function _pn(v) { if (typeof v === 'number') return v; if (!v) return 0; const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isNaN(n) ? 0 : n; }
function _pd(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim(); if (!s) return null;
  const M = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) { const mo = M[m[2].toLowerCase()]; if (mo != null) { let y = parseInt(m[3]); if (y < 100) y += y < 50 ? 2000 : 1900; return new Date(y, mo, parseInt(m[1])); } }
  const d = new Date(s); return (!isNaN(d.getTime()) && d.getFullYear() > 2000) ? d : null;
}

function _records(ssId, gid, src) {
  const ss = SpreadsheetApp.openById(ssId);
  const sh = ss.getSheets().find(s => s.getSheetId() === gid);
  if (!sh) return [];
  const vals = sh.getDataRange().getValues();
  let hi = 2;
  for (let i = 0; i < Math.min(10, vals.length); i++) {
    const j = vals[i].join('|').toLowerCase();
    if (j.indexOf('arr') >= 0 && j.indexOf('stage') >= 0 && (j.indexOf('account name') >= 0 || j.indexOf('ent name') >= 0)) { hi = i; break; }
  }
  const hdr = vals[hi].map(h => String(h).toLowerCase().trim().replace(/\s+/g, ' '));
  const col = (row, names) => { for (const n of names) { const i = hdr.indexOf(n); if (i >= 0) { const v = row[i]; if (v !== '' && v != null) return v; } } return ''; };
  const out = [];
  for (let r = hi + 1; r < vals.length; r++) {
    const row = vals[r];
    const name = col(row, ['account name', 'ent name']);
    const roof = col(row, ['rooftop name']);
    if (!name && !roof) continue;
    out.push({
      entityName: String(name || ''), rooftopName: String(roof || ''),
      arr: _pn(col(row, ['arr ($)', 'arr'])),
      stage: String(col(row, ['stage']) || ''),
      obPoc: String(col(row, ['ob poc']) || ''),
      product: String(col(row, ['product']) || ''),
      agent: String(col(row, ['agent opted']) || ''),
      projection: _pd(col(row, ['projected live date'])),
      goLive: _pd(col(row, ['go-live date'])),
      obCall: _pd(col(row, ['ob call date'])),
      liveTat: _pn(col(row, ['live tat'])),
      conf: String(col(row, ['current month confirmations']) || ''),
      source: src
    });
  }
  return out;
}

function _churn(tz, ym) {
  const ss = SpreadsheetApp.openById(CHURN_SPREADSHEET_ID);
  const sh = ss.getSheets().find(s => s.getSheetId() === CHURN_GID);
  const out = { vini: 0, studio: 0, total: 0 };
  if (!sh) return out;
  const vals = sh.getDisplayValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][4]).trim() === ym) {
      const a = _pn(vals[i][3]);
      if (String(vals[i][5]).trim().toLowerCase() === 'vini') out.vini += a; else out.studio += a;
      out.total += a;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Build + send the daily Slack report
// ─────────────────────────────────────────────────────────────
function sendSlackReport() {
  if (!SLACK_WEBHOOK_URL) throw new Error('SLACK_WEBHOOK_URL is not set in the script.');

  const rows = [].concat(
    _records(SPREADSHEET_ID, GID_MAP.vini, 'vini'),
    _records(SPREADSHEET_ID, GID_MAP.amer, 'amer'),
    _records(SPREADSHEET_ID, GID_MAP.apac, 'apac')
  );

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const yestStr  = Utilities.formatDate(new Date(now.getTime() - 864e5), tz, 'yyyy-MM-dd');
  const ym = todayStr.substring(0, 7);
  const y = Number(ym.substring(0, 4)), mo = Number(ym.substring(5, 7));
  const nmYM = (mo === 12 ? (y + 1) + '-01' : y + '-' + ('0' + (mo + 1)).slice(-2));
  const dow = Number(Utilities.formatDate(now, tz, 'u')); // 1=Mon..7=Sun
  const endWeekStr = Utilities.formatDate(new Date(now.getTime() + (7 - dow) * 864e5), tz, 'yyyy-MM-dd');
  const pYM  = d => d ? Utilities.formatDate(d, tz, 'yyyy-MM') : null;
  const pYMD = d => d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : null;
  const heading = Utilities.formatDate(now, tz, 'dd MMM yyyy');

  const isLive = r => /^live$/i.test(r.stage.trim());
  const isDrop = r => /drop|churn/i.test(r.stage);
  const inFunnel = r => !isLive(r) && !isDrop(r);
  const sum = a => a.reduce((s, r) => s + r.arr, 0);
  const uniq = a => { const s = {}; a.forEach(r => s[r.entityName || r.rooftopName || '?'] = 1); return Object.keys(s).length; };
  const isStudio = r => r.source !== 'vini', isVini = r => r.source === 'vini';

  const liveRows  = rows.filter(r => isLive(r) && pYM(r.goLive) === ym);
  const dropRows  = rows.filter(r => isDrop(r) && (pYM(r.goLive) === ym || pYM(r.projection) === ym));
  const expRows   = rows.filter(r => inFunnel(r) && pYM(r.projection) === ym);
  const funnelRows = rows.filter(inFunnel);
  const blockedRows = rows.filter(r => r.conf === 'Upside');
  const churn = _churn(tz, ym);

  const liveARR = sum(liveRows), dropARR = sum(dropRows), expARR = sum(expRows), funnelARR = sum(funnelRows), blockedARR = sum(blockedRows);
  const totalLARR = BASE_LARR_BY_PRODUCT.vini + BASE_LARR_BY_PRODUCT.studio + liveARR - dropARR - churn.total;
  const expConfARR = sum(expRows.filter(r => r.conf === 'Confirmed'));
  const meLARR = totalLARR + expARR, meLARRConf = totalLARR + expConfARR;
  const tatVals = rows.map(r => r.liveTat).filter(x => x > 0);
  const avgTat = tatVals.length ? tatVals.reduce((a, b) => a + b, 0) / tatVals.length : 0;

  const sched = rows.filter(inFunnel);
  const todayRows = sched.filter(r => pYMD(r.projection) === todayStr);
  const weekRows  = sched.filter(r => { const d = pYMD(r.projection); return d && d >= todayStr && d <= endWeekStr; });
  const yestRows  = rows.filter(r => isLive(r) && pYMD(r.goLive) === yestStr);
  const obYestRows = rows.filter(r => pYMD(r.obCall) === yestStr);

  const fmtC = n => { n = Math.round(n); const a = Math.abs(n); return a >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : a >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + n; };
  const fmt$ = n => '$' + Math.round(n).toLocaleString('en-US');

  // grouped scheduled-today lists
  const group = (items, kind) => {
    const m = {};
    items.forEach(r => { const e = r.entityName || r.rooftopName || '—'; const g = m[e] || (m[e] = { ent: e, n: 0, arr: 0, prod: {}, poc: {} }); g.n++; g.arr += r.arr; if (r.product) g.prod[r.product] = 1; if (r.obPoc) g.poc[r.obPoc] = 1; });
    return Object.keys(m).map(k => m[k]).sort((a, b) => b.arr - a.arr).map(g => {
      const unit = kind === 'studio' ? (g.n + ' rooftop' + (g.n > 1 ? 's' : '')) : (g.n + ' agent' + (g.n > 1 ? 's' : ''));
      const prod = kind === 'studio' && Object.keys(g.prod).length ? ' · ' + Object.keys(g.prod).join(', ') : '';
      const poc = Object.keys(g.poc).length ? ' _(' + Object.keys(g.poc).join(', ') + ')_' : '';
      return '• *' + g.ent + '* — ' + unit + prod + ' · ' + fmt$(g.arr) + poc;
    });
  };
  const studioLines = group(todayRows.filter(isStudio), 'studio');
  const viniLines   = group(todayRows.filter(isVini), 'vini');
  const cap = (lines, n) => lines.length > n ? lines.slice(0, n).concat(['_…and ' + (lines.length - n) + ' more_']) : lines;

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📊 OB Report — ' + heading } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'Spyne · Onboarding · Daily Snapshot' }] },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: '🟢 *Went Live Yesterday*\n' + fmtC(sum(yestRows)) + '  ·  ' + uniq(yestRows) + ' acct' },
      { type: 'mrkdwn', text: '🚀 *Going Live Today*\n' + fmtC(sum(todayRows)) + '  ·  this wk ' + fmtC(sum(weekRows)) },
      { type: 'mrkdwn', text: '📈 *Live This Month*\n' + fmtC(liveARR) + '  ·  ' + uniq(liveRows) + ' ent' },
      { type: 'mrkdwn', text: '📞 *Came In OB Yesterday*\n' + fmtC(sum(obYestRows)) + '  ·  ' + uniq(obYestRows) + ' acct' }
    ]},
    { type: 'divider' },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: '*Total LARR*\n' + fmtC(totalLARR) },
      { type: 'mrkdwn', text: '*Expected Go-Live*\n' + fmtC(expARR) + ' _(conf ' + fmtC(expConfARR) + ')_' },
      { type: 'mrkdwn', text: '*Exp. Month-End LARR*\n' + fmtC(meLARR) + ' _(conf ' + fmtC(meLARRConf) + ')_' },
      { type: 'mrkdwn', text: '*Blocked ARR (Upside)*\n' + fmtC(blockedARR) },
      { type: 'mrkdwn', text: '*Avg OB Time*\n' + (avgTat ? avgTat.toFixed(1) + 'd' : '—') },
      { type: 'mrkdwn', text: '*ARR in Funnel*\n' + fmtC(funnelARR) }
    ]},
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*🗓️ Scheduled to Go-Live Today*  (' + uniq(todayRows) + ' ent · ' + fmt$(sum(todayRows)) + ')' } }
  ];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Studio* (' + fmt$(sum(todayRows.filter(isStudio))) + ')\n' + (studioLines.length ? cap(studioLines, 12).join('\n') : '_None_') } });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Vini* (' + fmt$(sum(todayRows.filter(isVini))) + ')\n' + (viniLines.length ? cap(viniLines, 12).join('\n') : '_None_') } });

  const res = UrlFetchApp.fetch(SLACK_WEBHOOK_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ text: 'OB Report — ' + heading, blocks: blocks }),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), body: res.getContentText() };
}

// Run ONCE to schedule the daily 9 AM IST post (re-run safely; it de-dupes).
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'sendSlackReport') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendSlackReport').timeBased().atHour(9).nearMinute(0).everyDays(1).inTimezone('Asia/Kolkata').create();
}
