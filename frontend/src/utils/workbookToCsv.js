// Turns an .xlsx workbook into the CSV text the import endpoint already reads.
//
// The wire format stays CSV on purpose: there is one parser on the server, one set of round-trip
// tests, and no new backend dependency. This is a format adapter, not a second importer.
//
// ── Why this is hand-rolled on fflate rather than an xlsx library ──────────────────────────────
// ⚠️ Do not "simplify" this back to a reader library without re-running the FULL e2e suite.
//
// `read-excel-file` was the obvious pick and had to be abandoned: with a dynamic
// `import('read-excel-file')` anywhere in the source graph, the Vite dev server was killed partway
// through every full e2e run -- 5 runs, 5 deaths, at wildly different points (3, 4, 43, 51 and 74
// tests in) and with no `[[frontend exited rc=...]]` marker, which is the signature of the whole
// process tree going down rather than Vite exiting on its own. It survives on the same stack with
// that import removed (176 passed), with `import('fflate')` in its place (176 passed), and on main
// (170 passed). `optimizeDeps.exclude` did NOT fix it. The trigger is that package's Node-oriented
// dependency graph (`unzipper`, `@xmldom/xmldom`), which it pulls in even though its browser entry
// only needs fflate.
//
// `xlsx` (SheetJS) is not the alternative either: the last version on npm is 0.18.5, which carries
// CVE-2023-30533, and the fix ships only on the maintainers' own CDN.
//
// So: fflate (~8 kB, zero dependencies, browser-first) to unzip, and the platform's own DOMParser
// to read the XML. That also drops the 15 transitive packages the library brought with it.
//
// ── Why the conversion is value-aware ──────────────────────────────────────────────────────────
// A naive cell-to-string dump breaks duplicate detection silently, because a spreadsheet stores
// exactly the columns identity is built from as NUMBERS: 2026-08-20 is the serial 46259, and
// 09:14:32 is a fraction of a day. Whether a numeric cell is a date is knowable only from its
// style's number format, which is why styles.xml is read at all.
//
// The parser is loaded lazily by ImportDataModal, only once someone picks an .xlsx, so none of this
// enters the main bundle or the offline app shell.

const OOXML_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Columns without which a sheet isn't a workout export at all -- the same three the server
// requires. Used to pick the right sheet out of a multi-sheet workbook.
const REQUIRED = ['exercise', 'date'];
const MEASURE = ['reps', 'duration (sec)'];

// The built-in number formats Excel reserves for dates and times. Anything at 164 or above is
// user-defined and has to be read out of numFmts instead.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export async function workbookToCsv(file) {
  const { unzipSync } = await import('fflate');
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));

  const sharedStrings = readSharedStrings(zip);
  const dateStyles = readDateStyles(zip);
  const sheets = readSheetIndex(zip);

  let chosen = null;
  for (const sheet of sheets) {
    const xml = text(zip, sheet.path);
    if (!xml) continue;
    const rows = readSheet(xml, sharedStrings, dateStyles);
    if (looksLikeWorkoutData(rows)) {
      chosen = { name: sheet.name, rows };
      break;
    }
  }

  if (!chosen) {
    const names = sheets.map((s) => `"${s.name}"`).join(', ');
    throw new Error(
      'No sheet in that workbook looks like a workout export -- none has an Exercise and Date column.'
        + (names ? ` Sheets found: ${names}.` : ''),
    );
  }

  return { csv: toCsv(chosen.rows), sheetName: chosen.name };
}

// ── Workbook structure ─────────────────────────────────────────────────────────────────────────

// Sheets in workbook order. The <sheet> elements carry a relationship id rather than a path, so
// the rels file is what turns "rId1" into "worksheets/sheet1.xml" -- sheet order and file
// numbering are NOT reliably the same, which is why the indirection is followed properly.
function readSheetIndex(zip) {
  const workbook = text(zip, 'xl/workbook.xml');
  if (!workbook) return [];

  const rels = new Map();
  const relsXml = text(zip, 'xl/_rels/workbook.xml.rels');
  if (relsXml) {
    for (const rel of Array.from(parse(relsXml).getElementsByTagName('Relationship'))) {
      rels.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
    }
  }

  const sheets = [];
  for (const sheet of Array.from(parse(workbook).getElementsByTagName('sheet'))) {
    const relId = sheet.getAttributeNS(OOXML_REL_NS, 'id') || sheet.getAttribute('r:id');
    const target = rels.get(relId);
    if (!target) continue;
    // Targets are relative to xl/ and may be written with a leading slash or an xl/ prefix.
    const path = `xl/${String(target).replace(/^\/?xl\//, '').replace(/^\//, '')}`;
    sheets.push({ name: sheet.getAttribute('name') || '', path });
  }
  return sheets;
}

// The shared string table. Rich text splits one string across several <r><t> runs, so the runs are
// concatenated rather than taking the first.
function readSharedStrings(zip) {
  const xml = text(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];
  return Array.from(parse(xml).getElementsByTagName('si')).map((si) =>
    Array.from(si.getElementsByTagName('t'))
      .map((t) => t.textContent)
      .join(''),
  );
}

// Which style indexes mean "this number is a date". A cell's `s` attribute indexes cellXfs; that
// entry's numFmtId is either a built-in format or one defined in numFmts.
function readDateStyles(zip) {
  const dateStyles = new Set();
  const xml = text(zip, 'xl/styles.xml');
  if (!xml) return dateStyles;
  const doc = parse(xml);

  const customIsDate = new Map();
  for (const fmt of Array.from(doc.getElementsByTagName('numFmt'))) {
    const id = Number(fmt.getAttribute('numFmtId'));
    customIsDate.set(id, isDateFormatCode(fmt.getAttribute('formatCode') || ''));
  }

  const cellXfs = doc.getElementsByTagName('cellXfs')[0];
  if (!cellXfs) return dateStyles;
  Array.from(cellXfs.getElementsByTagName('xf')).forEach((xf, index) => {
    const numFmtId = Number(xf.getAttribute('numFmtId') || 0);
    if (BUILTIN_DATE_FORMATS.has(numFmtId) || customIsDate.get(numFmtId)) {
      dateStyles.add(index);
    }
  });
  return dateStyles;
}

// A format code is a date format if it uses date/time tokens outside of literal text. Quoted
// sections, bracketed conditions and escaped characters are stripped first -- otherwise a code
// like `0.00\ "days"` would read as a date because of the d.
function isDateFormatCode(code) {
  const withoutLiterals = code
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '');
  return /[yYmMdDhHs]/.test(withoutLiterals);
}

// ── One sheet ──────────────────────────────────────────────────────────────────────────────────

// Rows and cells are both sparse in the file -- a row with nothing in column B simply omits it --
// so cells are placed by their column letter and the gaps filled, or every column after a blank
// would shift left and silently land in the wrong heading.
function readSheet(xml, sharedStrings, dateStyles) {
  const rows = [];
  for (const row of Array.from(parse(xml).getElementsByTagName('row'))) {
    const values = [];
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const column = columnIndex(cell.getAttribute('r') || '');
      while (values.length < column) values.push(null);
      values[column] = readCell(cell, sharedStrings, dateStyles);
    }
    rows.push(values);
  }
  return rows;
}

function readCell(cell, sharedStrings, dateStyles) {
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') {
    return Array.from(cell.getElementsByTagName('t')).map((t) => t.textContent).join('');
  }

  const v = cell.getElementsByTagName('v')[0];
  if (!v) return null;
  const raw = v.textContent;
  if (raw === null || raw === '') return null;

  if (type === 's') return sharedStrings[Number(raw)] ?? null;
  if (type === 'str' || type === 'e') return raw;
  if (type === 'b') return raw === '1';
  // Already ISO-8601 in the file; hand it straight through.
  if (type === 'd') return raw;

  const numeric = Number(raw);
  if (Number.isNaN(numeric)) return raw;

  const style = Number(cell.getAttribute('s') || 0);
  return dateStyles.has(style) ? excelSerialToDate(numeric) : numeric;
}

// Excel counts days from 1899-12-30 in the 1900 date system -- 25569 days before the Unix epoch.
// That offset already absorbs Excel's deliberate 1900-leap-year bug for every date from 1900-03-01
// onwards, which is everything a workout log could contain.
function excelSerialToDate(serial) {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

// "BC12" -> 54. Only the letters matter; the row number is ignored.
function columnIndex(ref) {
  let index = 0;
  for (const char of ref) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return Math.max(0, index - 1);
}

// ── Output ─────────────────────────────────────────────────────────────────────────────────────

function looksLikeWorkoutData(rows) {
  if (!rows.length) return false;
  const headers = rows[0].map((cell) => String(cell ?? '').trim().toLowerCase());
  return REQUIRED.every((name) => headers.includes(name)) && MEASURE.some((name) => headers.includes(name));
}

function toCsv(rows) {
  return rows.map((row) => row.map(formatCell).map(escape).join(',')).join('\n');
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

// The canonical strings the exporter writes. A spreadsheet stores a date and a time in the same
// kind of cell, so which one this is comes from whether there is a time component: a bare date
// keeps the Date column's shape, and anything carrying a time is emitted as a full datetime, which
// the server accepts in either the Date or the Session Start column.
//
// Read in UTC deliberately -- Excel's serials carry no timezone and the exporter writes UTC, so
// interpreting them in the viewer's local zone would shift every instant by the offset and break
// duplicate detection against the very file this app produced.
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

// ── Zip / XML helpers ──────────────────────────────────────────────────────────────────────────

function text(zip, path) {
  const entry = zip[path];
  return entry ? new TextDecoder().decode(entry) : null;
}

function parse(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error("That workbook couldn't be read -- its internal format is not valid .xlsx.");
  }
  return doc;
}
