// ============================================================
// SPYNE OB DASHBOARD — Google Apps Script data proxy
// Serves sheet data to the dashboard: doGet ?sheet=vini|amer|apac|churn
// Deploy as Web App: Execute as "Me", Access "Anyone".
// (Slack delivery is handled separately by the GitHub Action screenshot bot.)
// ============================================================

const SPREADSHEET_ID = '1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0';
const GID_MAP = { vini: 2053683245, amer: 1134407178, apac: 764039413 };

// CS churn/contraction dashboard (separate spreadsheet)
const CHURN_SPREADSHEET_ID = '1H5cBuWmLD_roF_LV3foWII37PHbTqqNdzCcVGeAGU8A';
const CHURN_GID = 1421999984;

// AE / AE-Manager mapping by Enterprise ID (separate spreadsheet)
const AE_SPREADSHEET_ID = '131ItK3zb2cb6ZJNP1JZ5fIbgL7DRbCFeAaZCxnaRIjI';
const AE_GID = 0;

// Partnership RAG dashboard (separate spreadsheet) — col R "Delta" drives Expansion/Churn
const PARTNERSHIP_SPREADSHEET_ID = '1kvvDbnpUAodPnmnLEVAWejLAzTwEflkzLSkXiAeOkB4';
const PARTNERSHIP_GID = 135115178;

// Program Management tracker (separate spreadsheet)
const PROGRAMS_SPREADSHEET_ID = '1RUr1PeSmqTkqtfnrEXdfqlfvHnlX1TXhh-SvgnYE3EQ';
const PROGRAMS_GID = 0;

// Shared secret for the daily-email endpoint (doPost). Set this to the SAME value
// you store as the GitHub Action secret MAIL_SECRET. Leave blank to disable emailing.
const MAIL_SECRET = '';   // e.g. obmail-xxxxxxxx-xxxx-...

function doGet(e) {
  try {
    const sheet = (e.parameter.sheet || 'vini').toLowerCase();

    // Program 2/3/4 shared Owner/ETA inputs — read the ProgramInputs tab (by name).
    if (sheet === 'proginputs') {
      const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('ProgramInputs');
      const values = sh ? sh.getDataRange().getDisplayValues() : [['key', 'owner', 'eta', 'updated_at']];
      const csv = values.map(row => row.map(cell => {
        const s = String(cell === null || cell === undefined ? '' : cell);
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')).join('\n');
      return ContentService.createTextOutput(JSON.stringify({ csv, syncedAt: new Date().toISOString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Consolidated "Program data" feed — merges the 3 OB tabs (vini/amer/apac) into one clean
    // table of in-OB rows with Blocked Owner + Blocked Reason etc. Returns RAW CSV so a Google
    // Sheet can pull it with a single =IMPORTDATA("<exec>?sheet=programdata").
    if (sheet === 'programdata') {
      const ss0 = SpreadsheetApp.openById(SPREADSHEET_ID);
      const tabs = [{ gid: GID_MAP.vini, src: 'Vini' }, { gid: GID_MAP.amer, src: 'Studio-AMER' }, { gid: GID_MAP.apac, src: 'Studio-APAC' }];
      const findCol = (h, names) => {
        const low = h.map(x => String(x).trim().toLowerCase());
        for (const n of names) { const i = low.indexOf(n); if (i >= 0) return i; }
        for (const n of names) { for (let i = 0; i < low.length; i++) if (low[i].indexOf(n) >= 0) return i; }
        return -1;
      };
      const out = [['Account', 'Enterprise ID', 'Product', 'ARR', 'Stage', 'Sub Stage', 'OB POC', 'Confirmation', 'Blocked Owner', 'Blocked Reason', 'Projected Live Date', 'Source']];
      tabs.forEach(t => {
        const sh = ss0.getSheets().find(s => s.getSheetId() === t.gid); if (!sh) return;
        const vals = sh.getDataRange().getDisplayValues();
        let hi = -1;
        for (let i = 0; i < Math.min(vals.length, 8); i++) { if (vals[i].map(c => String(c).trim().toLowerCase()).indexOf('stage') >= 0) { hi = i; break; } }
        if (hi < 0) return;
        const h = vals[hi];
        const c = { acct: findCol(h, ['account name', 'ent name']), ent: findCol(h, ['enterprise id']), prod: findCol(h, ['product']), arr: findCol(h, ['arr ($)', 'arr']), stage: findCol(h, ['stage']), sub: findCol(h, ['sub stage']), poc: findCol(h, ['ob poc']), conf: findCol(h, ['current month confirmations']), bo: findCol(h, ['blocked owner', 'blocked bucketing']), br: findCol(h, ['blocked remarks', 'past delay reasons/action items/remarks']), proj: findCol(h, ['projected live date']) };
        for (let i = hi + 1; i < vals.length; i++) {
          const r = vals[i], g = idx => (idx >= 0 && idx < r.length ? String(r[idx] || '') : '');
          const acct = g(c.acct).trim(); if (!acct) continue;
          const st = g(c.stage).trim().toLowerCase();
          if (!st || st.indexOf('live') === 0 || st.indexOf('drop') >= 0 || st.indexOf('churn') >= 0) continue;   // in-OB only
          out.push([acct, g(c.ent), (g(c.prod).trim() || (t.src === 'Vini' ? 'Vini' : 'Studio')), g(c.arr), g(c.stage), g(c.sub), g(c.poc), g(c.conf), g(c.bo), g(c.br), g(c.proj), t.src]);
        }
      });
      const csvP = out.map(row => row.map(cell => { const s = String(cell == null ? '' : cell); return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
      return ContentService.createTextOutput(csvP).setMimeType(ContentService.MimeType.CSV);
    }

    let ssId, gid, useDisplay = false;
    if (sheet === 'churn') { ssId = CHURN_SPREADSHEET_ID; gid = CHURN_GID; useDisplay = true; }
    else if (sheet === 'aemap') { ssId = AE_SPREADSHEET_ID; gid = AE_GID; useDisplay = true; }
    else if (sheet === 'partnership') { ssId = PARTNERSHIP_SPREADSHEET_ID; gid = PARTNERSHIP_GID; }
    else if (sheet === 'programs') { ssId = PROGRAMS_SPREADSHEET_ID; gid = PROGRAMS_GID; useDisplay = true; }
    else { ssId = SPREADSHEET_ID; gid = GID_MAP[sheet]; }
    if (gid === undefined || gid === null) return respond({ error: 'Unknown sheet: ' + sheet });

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

// Daily email endpoint — the GitHub Action POSTs the report here and this emails
// it from your Google account via GmailApp. Preferred payload: { html } (a full
// email-safe HTML body — no image, no attachment). If a legacy { png } is sent,
// it is embedded inline only (never attached).
function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    // Program 2/3/4 shared Owner/ETA save (no secret — low-value, sheet-scoped, structured).
    if (b.action === 'progInput') return saveProgInput(b);
    if (!MAIL_SECRET || b.secret !== MAIL_SECRET) return respond({ error: 'unauthorized' });
    const opts = { htmlBody: b.html || '', name: 'Spyne OB Reports' };
    if (b.png) {
      const blob = Utilities.newBlob(Utilities.base64Decode(b.png), 'image/png', b.filename || 'ob-report.png');
      opts.inlineImages = { obreport: blob };   // inline only — no attachment
    }
    GmailApp.sendEmail(b.to || 'reports@spyne.ai', b.subject || 'OB Report', b.text || 'OB Report.', opts);
    return respond({ ok: true });
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

// Upsert one Program 2/3/4 Owner/ETA input into the ProgramInputs tab (created if missing),
// keyed by the dashboard's row key. Shared across all viewers.
function saveProgInput(b) {
  const key = String(b.key || '').trim();
  if (!key) return respond({ error: 'no key' });
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName('ProgramInputs');
  if (!sh) { sh = ss.insertSheet('ProgramInputs'); sh.appendRow(['key', 'owner', 'eta', 'updated_at']); }
  const data = sh.getDataRange().getValues();
  let row = -1;
  for (let i = 1; i < data.length; i++) { if (String(data[i][0]) === key) { row = i + 1; break; } }
  const now = new Date().toISOString();
  if (row === -1) sh.appendRow([key, b.owner || '', b.eta || '', now]);
  else sh.getRange(row, 2, 1, 3).setValues([[b.owner || '', b.eta || '', now]]);
  return respond({ ok: true });
}

// Run this ONCE from the editor to grant the Gmail permission and confirm sending works.
function sendTestEmail() {
  GmailApp.sendEmail('reports@spyne.ai', 'OB Report — test', 'Test email from the OB Apps Script. If you see this, sending works.');
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
