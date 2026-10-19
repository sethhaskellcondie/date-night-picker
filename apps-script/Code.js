// Mirror of the Apps Script bound to the date ideas sheet
// (Extensions → Apps Script). Deploying is still copy-paste into that editor,
// then Deploy → Manage deployments → edit → Version: New version.
// See design_notes.md → "The Apps Script".

const TAB_NAME = 'Activities'; // the existing tab's name; check it in the sheet

function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAME);
  return ContentService.createTextOutput(
    JSON.stringify({ activities: tabToObjects(sheet) }),
  ).setMimeType(ContentService.MimeType.JSON);
}

// Same as p7-deacons-site, except headers are trimmed + lowercased so
// "Time " or "Budget" in row 1 still map to the right field.
function tabToObjects(sheet) {
  const [headers, ...rows] = sheet.getDataRange().getValues();
  const keys = headers.map((h) => String(h).trim().toLowerCase());
  return rows
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => Object.fromEntries(keys.map((k, i) => [k, String(row[i])])));
}
