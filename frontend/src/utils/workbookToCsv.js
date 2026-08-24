// Turns an .xlsx workbook into the CSV text the import endpoint already reads.
//
// The wire format stays CSV on purpose: there is one parser on the server, one set of round-trip
// tests, and no new backend dependency. This is a format adapter, not a second importer.
//
// ── Why the conversion has to be value-aware ───────────────────────────────────────────────────
// A naive cell-to-string dump breaks duplicate detection silently, because a spreadsheet reformats
// exactly the columns that identify a set. 2026-08-20 comes back as a Date (displayed 8/20/2026),
// 09:14:32 as "9:14:32 AM". The importer's date parsing is tolerant enough to cope with both, but
// relying on that would mean every Excel round trip depends on a fallback rather than on being
// correct here. Date cells are re-formatted to the canonical UTC strings the exporter writes.
//
// The parser is loaded lazily, only once someone actually picks an .xlsx, so it never enters the
// main bundle and never touches the offline app shell. Import is online-gated anyway, so fetching
// a chunk at the moment of use costs nothing that was available offline.

// Columns without which a sheet isn't a workout export at all -- the same three the server
// requires. Used to pick the right sheet out of a multi-sheet workbook.
const REQUIRED = ['exercise', 'date'];
const MEASURE = ['reps', 'duration (sec)'];

export async function workbookToCsv(file) {
  const { default: readXlsxFile } = await import('read-excel-file');

  const { sheets } = await readXlsxFile(file, { getSheets: true });
  let chosen = null;
  for (const sheet of sheets) {
    const rows = await readXlsxFile(file, { sheet: sheet.name });
    if (looksLikeWorkoutData(rows)) {
      chosen = { name: sheet.name, rows };
      break;
    }
  }

  if (!chosen) {
    const names = sheets.map((s) => `"${s.name}"`).join(', ');
    throw new Error(
      `No sheet in that workbook looks like a workout export -- none has an Exercise and Date column. Sheets found: ${names}.`,
    );
  }

  return { csv: toCsv(chosen.rows), sheetName: chosen.name };
}

function looksLikeWorkoutData(rows) {
  if (!rows.length) return false;
  const headers = rows[0].map((cell) => String(cell ?? '').trim().toLowerCase());
  return REQUIRED.every((name) => headers.includes(name)) && MEASURE.some((name) => headers.includes(name));
}

function toCsv(rows) {
  return rows.map((row) => row.map(formatCell).map(escape).join(',')).join('\n');
}

// A Date reaching here is a date cell, a time cell, or both in one. Which of the three is not
// recorded anywhere in the file, so the shape is inferred from the value: midnight with no date
// component of its own can't be told apart from a real midnight, so a full datetime is always
// emitted for anything carrying a time, and the server accepts that in the Date column.
function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

// read-excel-file hands back Dates built from the workbook's own wall-clock values in UTC, which is
// the same frame the exporter writes in -- so the components are used directly rather than being
// shifted through a local timezone that would move the instant by hours.
function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const hms = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  return hms === '00:00:00' ? ymd : `${ymd} ${hms}`;
}

// Matches the server's own csvEscape, so a value that came out of an export survives going back in.
function escape(value) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
