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

// Shared secret for the daily-email endpoint (doPost). Set this to the SAME value
// you store as the GitHub Action secret MAIL_SECRET. Leave blank to disable emailing.
const MAIL_SECRET = '';   // e.g. obmail-xxxxxxxx-xxxx-...

function doGet(e) {
  try {
    const sheet = (e.parameter.sheet || 'vini').toLowerCase();
    let ssId, gid, useDisplay = false;
    if (sheet === 'churn') { ssId = CHURN_SPREADSHEET_ID; gid = CHURN_GID; useDisplay = true; }
    else if (sheet === 'aemap') { ssId = AE_SPREADSHEET_ID; gid = AE_GID; useDisplay = true; }
    else if (sheet === 'partnership') { ssId = PARTNERSHIP_SPREADSHEET_ID; gid = PARTNERSHIP_GID; }
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

// Daily email endpoint — the GitHub Action POSTs the Email-View screenshot here,
// and this emails it (inline + attached) from your Google account via GmailApp.
function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (!MAIL_SECRET || b.secret !== MAIL_SECRET) return respond({ error: 'unauthorized' });
    const blob = Utilities.newBlob(Utilities.base64Decode(b.png), 'image/png', b.filename || 'ob-report.png');
    GmailApp.sendEmail(b.to || 'reports@spyne.ai', b.subject || 'OB Report', b.text || 'OB Report (see attached).', {
      htmlBody: b.html || '',
      attachments: [blob],
      inlineImages: { obreport: blob },
      name: 'Spyne OB Reports'
    });
    return respond({ ok: true });
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

// Run this ONCE from the editor to grant the Gmail permission and confirm sending works.
function sendTestEmail() {
  GmailApp.sendEmail('reports@spyne.ai', 'OB Report — test', 'Test email from the OB Apps Script. If you see this, sending works.');
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
