import { describe, expect, it, vi } from 'vitest';

// read-excel-file is loaded lazily by the adapter, so the mock has to be a module factory the
// dynamic import resolves to.
const readXlsxFile = vi.fn();
vi.mock('read-excel-file', () => ({ default: (...args) => readXlsxFile(...args) }));

const { workbookToCsv } = await import('./workbookToCsv');

// Given a workbook shaped as { sheetName: rows }, answer read-excel-file's two call shapes.
function mockWorkbook(sheets) {
  readXlsxFile.mockImplementation((_file, options) => {
    if (options?.getSheets) {
      return Promise.resolve({ sheets: Object.keys(sheets).map((name) => ({ name })) });
    }
    return Promise.resolve(sheets[options.sheet]);
  });
}

describe('workbookToCsv', () => {
  // The whole reason this adapter is value-aware rather than a cell-to-string dump: a spreadsheet
  // hands back Dates for exactly the columns duplicate detection is built from, and "8/20/2026"
  // is not what the server compares against.
  it('renders date and time cells as the canonical strings the exporter writes', async () => {
    mockWorkbook({
      Sheet1: [
        ['Date', 'Time', 'Session Start', 'Exercise', 'Reps'],
        [
          new Date(Date.UTC(2026, 7, 20)),
          new Date(Date.UTC(2026, 7, 20, 9, 14, 32)),
          new Date(Date.UTC(2026, 7, 20, 9, 12, 0)),
          'Barbell Bench Press',
          8,
        ],
      ],
    });

    const { csv } = await workbookToCsv({});

    const [, row] = csv.split('\n');
    expect(row).toBe('2026-08-20,2026-08-20 09:14:32,2026-08-20 09:12:00,Barbell Bench Press,8');
  });

  it('escapes exactly like the exporter, so a value survives the round trip', async () => {
    mockWorkbook({
      Sheet1: [
        ['Exercise', 'Date', 'Reps', 'Tags'],
        ['Bench, wide grip', '2026-08-20', 8, 'Full Body, Conditioning'],
      ],
    });

    const { csv } = await workbookToCsv({});

    expect(csv.split('\n')[1]).toBe('"Bench, wide grip",2026-08-20,8,"Full Body, Conditioning"');
  });

  it('skips a sheet that is not workout data and reads the one that is', async () => {
    mockWorkbook({
      Notes: [['Something', 'Else'], ['a', 'b']],
      Workouts: [
        ['Exercise', 'Date', 'Reps'],
        ['Pull-up', '2026-08-20', 6],
      ],
    });

    const { csv, sheetName } = await workbookToCsv({});

    expect(sheetName).toBe('Workouts');
    expect(csv.split('\n')[1]).toBe('Pull-up,2026-08-20,6');
  });

  it('names the sheets it found when none of them is workout data', async () => {
    mockWorkbook({ Notes: [['Something']], Totals: [['Else']] });

    await expect(workbookToCsv({})).rejects.toThrow(/"Notes", "Totals"/);
  });

  it('needs a measure column, not just Exercise and Date', async () => {
    mockWorkbook({ Sheet1: [['Exercise', 'Date'], ['Pull-up', '2026-08-20']] });

    await expect(workbookToCsv({})).rejects.toThrow(/Exercise and Date/);
  });
});
