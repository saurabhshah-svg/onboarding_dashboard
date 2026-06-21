// ============================================================
// SPYNE OB DASHBOARD — Google Apps Script Proxy
// Deploy as Web App: Execute as "Me", Access "Anyone"
// ============================================================

const SPREADSHEET_ID = '1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0';
const GID_MAP = { vini: 2053683245, amer: 1134407178, apac: 764039413 };

// CS churn/contraction dashboard (a SEPARATE spreadsheet)
// Col D = Churn/Contraction ARR, Col E = Churn/Contraction Month (YYYY-MM)
const CHURN_SPREADSHEET_ID = '1H5cBuWmLD_roF_LV3foWII37PHbTqqNdzCcVGeAGU8A';
const CHURN_GID = 1421999984;

function doGet(e) {
  try {
    const sheet = (e.parameter.sheet || 'vini').toLowerCase();

    // Resolve which spreadsheet + tab to serve.
    let ssId, gid, useDisplay = false;
    if (sheet === 'churn') {
      ssId = CHURN_SPREADSHEET_ID;
      gid = CHURN_GID;
      useDisplay = true;  // return displayed strings so the month reads "2026-06", not a Date object
    } else {
      ssId = SPREADSHEET_ID;
      gid = GID_MAP[sheet];
    }
    if (!gid) return respond({ error: 'Unknown sheet: ' + sheet });

    const ss = SpreadsheetApp.openById(ssId);
    const target = ss.getSheets().find(s => s.getSheetId() === gid);
    if (!target) return respond({ error: 'GID not found: ' + gid });

    const values = useDisplay
      ? target.getDataRange().getDisplayValues()
      : target.getDataRange().getValues();

    const csv = values.map(row =>
      row.map(cell => {
        const s = String(cell === null || cell === undefined ? '' : cell);
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
          ? '"' + s.replace(/"/g, '""') + '"'
          : s;
      }).join(',')
    ).join('\n');

    return ContentService
      .createTextOutput(JSON.stringify({ csv, syncedAt: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return respond({ error: err.toString() });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
