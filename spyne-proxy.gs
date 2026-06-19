// ============================================================
// SPYNE OB DASHBOARD — Google Apps Script Proxy
// Deploy as Web App: Execute as "Me", Access "Anyone"
// ============================================================

const SPREADSHEET_ID = '1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0';
const GID_MAP = { vini: 2053683245, amer: 1134407178, apac: 764039413 };

function doGet(e) {
  try {
    const sheet = (e.parameter.sheet || 'vini').toLowerCase();
    const gid   = GID_MAP[sheet];
    if (!gid) return respond({ error: 'Unknown sheet: ' + sheet });

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const target = ss.getSheets().find(s => s.getSheetId() === gid);
    if (!target) return respond({ error: 'GID not found: ' + gid });

    const values = target.getDataRange().getValues();
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
