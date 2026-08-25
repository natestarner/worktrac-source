import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { workbookToCsv } from './workbookToCsv';

// These build REAL .xlsx bytes rather than mocking a reader, because the whole risk in this file
// is the format itself: shared strings, sparse cells, and above all whether a numeric cell is a
// date. A mock would assert nothing about any of that.

// Style 0 is General, style 1 is built-in date format 14, style 2 is built-in time format 21.
const STYLES = `<?xml version="1.0"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cellXfs count="3">
    <xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="21"/>
  </cellXfs>
</styleSheet>`;

function sheetXml(rows) {
  const body = rows
    .map((cells, r) => {
      const inner = cells
        .map((cell, c) => {
          if (cell === null) return '';
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          const type = cell.t ? ` t="${cell.t}"` : '';
          const style = cell.s ? ` s="${cell.s}"` : '';
          return `<c r="${ref}"${type}${style}><v>${cell.v}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${inner}</row>`;
    })
    .join('');
  return `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

// `sheets` is [{ name, rows }]; `strings` is the shared string table the rows index into.
function buildXlsx(sheets, strings = []) {
  const files = {
    'xl/styles.xml': strToU8(STYLES),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
        .map((s) => `<si><t>${s}</t></si>`)
        .join('')}</sst>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows));
  });

  const bytes = zipSync(files);
  // Only arrayBuffer() is used by the adapter, so this is all a File needs to be here.
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

const str = (i) => ({ t: 's', v: i });
const num = (v) => ({ v });
const dateCell = (serial) => ({ v: serial, s: 1 });
const timeCell = (fraction) => ({ v: fraction, s: 2 });

describe('workbookToCsv', () => {
  // The reason this adapter exists at all: a spreadsheet stores these as numbers, and only the
  // cell's style says they are dates. Getting this wrong breaks duplicate detection silently.
  it('turns date- and time-formatted numbers back into the exporter\'s canonical strings', async () => {
    // 46254 = 2026-08-20. 0.3850925925 of a day = 09:14:32.
    const file = buildXlsx(
      [
        {
          name: 'Sheet1',
          rows: [
            [str(0), str(1), str(2), str(3)],
            [dateCell(46254), { v: 46254.385092592594, s: 2 }, str(4), num(8)],
          ],
        },
      ],
      ['Date', 'Session Start', 'Exercise', 'Reps', 'Barbell Bench Press'],
    );

    const { csv } = await workbookToCsv(file);

    expect(csv.split('\n')[1]).toBe('2026-08-20,2026-08-20 09:14:32,Barbell Bench Press,8');
  });

  it('leaves an ordinary number alone even though it could be read as a serial', async () => {
    const file = buildXlsx(
      [{ name: 'Sheet1', rows: [[str(0), str(1), str(2), str(3)], [dateCell(46254), str(4), num(135), num(8)]] }],
      ['Date', 'Exercise', 'Weight', 'Reps', 'Barbell Bench Press'],
    );

    const { csv } = await workbookToCsv(file);

    expect(csv.split('\n')[1]).toBe('2026-08-20,Barbell Bench Press,135,8');
  });

  it('keeps columns aligned when a row omits a cell', async () => {
    // No Weight cell on the data row -- the file simply has no <c> for column C.
    const file = buildXlsx(
      [
        {
          name: 'Sheet1',
          rows: [
            [str(0), str(1), str(2), str(3)],
            [dateCell(46254), str(4), null, num(8)],
          ],
        },
      ],
      ['Date', 'Exercise', 'Weight', 'Reps', 'Pull-up'],
    );

    const { csv } = await workbookToCsv(file);

    // The blank must stay in column C, not shift Reps left into it.
    expect(csv.split('\n')[1]).toBe('2026-08-20,Pull-up,,8');
  });

  it('escapes exactly like the exporter, so a value survives the round trip', async () => {
    const file = buildXlsx(
      [{ name: 'Sheet1', rows: [[str(0), str(1), str(2)], [str(3), dateCell(46254), num(8)]] }],
      ['Exercise', 'Date', 'Reps', 'Bench, wide grip'],
    );

    const { csv } = await workbookToCsv(file);

    expect(csv.split('\n')[1]).toBe('"Bench, wide grip",2026-08-20,8');
  });

  it('skips a sheet that is not workout data and reads the one that is', async () => {
    const file = buildXlsx(
      [
        { name: 'Notes', rows: [[str(0)], [str(1)]] },
        { name: 'Workouts', rows: [[str(2), str(3), str(4)], [str(5), dateCell(46254), num(6)]] },
      ],
      ['Something', 'else', 'Exercise', 'Date', 'Reps', 'Pull-up'],
    );

    const { csv, sheetName } = await workbookToCsv(file);

    expect(sheetName).toBe('Workouts');
    expect(csv.split('\n')[1]).toBe('Pull-up,2026-08-20,6');
  });

  it('names the sheets it found when none of them is workout data', async () => {
    const file = buildXlsx(
      [
        { name: 'Notes', rows: [[str(0)]] },
        { name: 'Totals', rows: [[str(1)]] },
      ],
      ['Something', 'Else'],
    );

    await expect(workbookToCsv(file)).rejects.toThrow(/"Notes", "Totals"/);
  });

  it('needs a measure column, not just Exercise and Date', async () => {
    const file = buildXlsx(
      [{ name: 'Sheet1', rows: [[str(0), str(1)], [str(2), dateCell(46254)]] }],
      ['Exercise', 'Date', 'Pull-up'],
    );

    await expect(workbookToCsv(file)).rejects.toThrow(/Exercise and Date/);
  });

  it('reads a Duration (sec) sheet, since either measure column qualifies', async () => {
    const file = buildXlsx(
      [{ name: 'Sheet1', rows: [[str(0), str(1), str(2)], [str(3), dateCell(46254), num(65)]] }],
      ['Exercise', 'Date', 'Duration (sec)', 'Wall Sit'],
    );

    const { csv } = await workbookToCsv(file);

    expect(csv.split('\n')[1]).toBe('Wall Sit,2026-08-20,65');
  });

  it('rejects something that is not a workbook at all with a readable message', async () => {
    const notAWorkbook = { arrayBuffer: async () => strToU8('this is a photo, not a spreadsheet').buffer };

    await expect(workbookToCsv(notAWorkbook)).rejects.toThrow();
  });

  // A time-only cell has no date part; Excel stores it against 1899-12-30.
  it('handles a time-only cell without inventing a date', async () => {
    const file = buildXlsx(
      [
        {
          name: 'Sheet1',
          rows: [
            [str(0), str(1), str(2), str(3)],
            [dateCell(46254), timeCell(0.3850925925925926), str(4), num(8)],
          ],
        },
      ],
      ['Date', 'Time', 'Exercise', 'Reps', 'Pull-up'],
    );

    const { csv } = await workbookToCsv(file);

    expect(csv.split('\n')[1]).toBe('2026-08-20,1899-12-30 09:14:32,Pull-up,8');
  });
});
