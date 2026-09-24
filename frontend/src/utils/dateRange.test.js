import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  eachDay,
  endOfWeek,
  formatDateRangeLabel,
  formatLongDate,
  formatMonthLabel,
  isDateInRange,
  isValidDateStr,
  monthGrid,
  normalizeRange,
  rangesOverlap,
  selectDate,
  singleDayRange,
  startOfWeek,
  weekdayNames,
} from './dateRange';

describe('day arithmetic on local date strings', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  // The US spring-forward (Mar 8 2026) and fall-back (Nov 1 2026) days are 23h and 25h long. A
  // midnight-based implementation stepping by 24h lands on the wrong day across them; noon cannot.
  it('never skips or repeats a day across a DST transition', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('adds months, clamping to the target month’s last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
    expect(addMonths('2026-01-10', -1)).toBe('2025-12-10');
    expect(addMonths('2026-09-12', 12)).toBe('2027-09-12');
  });

  it('finds the start and end of the week for either week start', () => {
    // 2026-09-16 is a Wednesday.
    expect(startOfWeek('2026-09-16', 0)).toBe('2026-09-13');
    expect(endOfWeek('2026-09-16', 0)).toBe('2026-09-19');
    expect(startOfWeek('2026-09-16', 1)).toBe('2026-09-14');
    expect(endOfWeek('2026-09-16', 1)).toBe('2026-09-20');
  });

  it('rejects strings that are not a real day', () => {
    expect(isValidDateStr('2026-09-12')).toBe(true);
    expect(isValidDateStr('2026-02-30')).toBe(false);
    expect(isValidDateStr('2026-9-12')).toBe(false);
    expect(isValidDateStr(null)).toBe(false);
  });
});

describe('monthGrid', () => {
  it('lays a month out in whole weeks with null padding', () => {
    // September 2026 starts on a Tuesday and has 30 days.
    const weeks = monthGrid('2026-09-20', 0);
    expect(weeks[0]).toEqual([null, null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.at(-1)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', null, null, null]);
  });

  it('honours a Monday week start', () => {
    const weeks = monthGrid('2026-09-01', 1);
    expect(weeks[0].slice(0, 2)).toEqual([null, '2026-09-01']);
  });

  it('uses only as many rows as the month needs', () => {
    // February 2026 starts on a Sunday: exactly four rows.
    expect(monthGrid('2026-02-01', 0)).toHaveLength(4);
  });
});

describe('the range value', () => {
  it('a single day is a range whose ends are equal, and is inclusive', () => {
    const r = singleDayRange('2026-09-12');
    expect(r).toEqual({ from: '2026-09-12', to: '2026-09-12' });
    expect(isDateInRange('2026-09-12', r)).toBe(true);
    expect(isDateInRange('2026-09-11', r)).toBe(false);
    expect(isDateInRange('2026-09-13', r)).toBe(false);
  });

  it('is inclusive at both ends of a multi-day range, and orders a backwards one', () => {
    const r = normalizeRange({ from: '2026-09-12', to: '2026-09-01' });
    expect(r).toEqual({ from: '2026-09-01', to: '2026-09-12' });
    expect(isDateInRange('2026-09-01', r)).toBe(true);
    expect(isDateInRange('2026-09-12', r)).toBe(true);
    expect(isDateInRange('2026-08-31', r)).toBe(false);
  });

  it('overlap: true when the ranges share any day, including one enclosing the other', () => {
    const week = { from: '2026-09-07', to: '2026-09-13' };
    expect(rangesOverlap(week, { from: '2026-09-13', to: '2026-09-14' })).toBe(true); // touches the end
    expect(rangesOverlap(week, { from: '2026-09-01', to: '2026-09-07' })).toBe(true); // touches the start
    expect(rangesOverlap(week, { from: '2026-09-01', to: '2026-09-30' })).toBe(true); // encloses it
    expect(rangesOverlap(week, { from: '2026-09-10', to: '2026-09-10' })).toBe(true); // inside it
    expect(rangesOverlap(week, { from: '2026-09-14', to: '2026-09-20' })).toBe(false);
    expect(rangesOverlap(week, null)).toBe(false);
  });

  it('eachDay lists every day inclusive, and stops at its backstop', () => {
    expect(eachDay('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(eachDay('2026-09-12', '2026-09-12')).toEqual(['2026-09-12']);
    expect(eachDay('2026-09-12', '2026-09-11')).toEqual([]);
    expect(eachDay('2000-01-01', '2026-01-01', 5)).toHaveLength(5);
  });

  it('matches nothing when there is no range', () => {
    expect(isDateInRange('2026-09-12', null)).toBe(false);
    expect(normalizeRange(null)).toBe(null);
  });
});

describe('selectDate', () => {
  it('single mode: every tap is a complete one-day selection', () => {
    expect(selectDate({ mode: 'single' }, '2026-09-12')).toEqual({
      selection: { from: '2026-09-12', to: '2026-09-12' },
      complete: true,
    });
  });

  // Not offered in the UI yet -- but it is the whole of what a range picker needs, so it is pinned.
  it('range mode: the first tap anchors, the second completes in either direction, a third restarts', () => {
    const first = selectDate({ mode: 'range', pending: null }, '2026-09-12');
    expect(first).toEqual({ selection: { from: '2026-09-12', to: null }, complete: false });

    const second = selectDate({ mode: 'range', pending: first.selection }, '2026-09-03');
    expect(second).toEqual({ selection: { from: '2026-09-03', to: '2026-09-12' }, complete: true });

    const restart = selectDate({ mode: 'range', pending: second.selection }, '2026-09-20');
    expect(restart).toEqual({ selection: { from: '2026-09-20', to: null }, complete: false });
  });

  it('range mode: tapping the anchor again makes a one-day range', () => {
    const first = selectDate({ mode: 'range' }, '2026-09-12');
    expect(selectDate({ mode: 'range', pending: first.selection }, '2026-09-12').selection).toEqual({
      from: '2026-09-12',
      to: '2026-09-12',
    });
  });
});

describe('labels', () => {
  const now = new Date(2026, 8, 24, 12);

  it('names a single day with its weekday, and the year only when it is not this year', () => {
    expect(formatDateRangeLabel(singleDayRange('2026-09-12'), now)).toBe('Sat, Sep 12');
    expect(formatDateRangeLabel(singleDayRange('2025-12-31'), now)).toBe('Wed, Dec 31, 2025');
  });

  it('names a range by its ends', () => {
    expect(formatDateRangeLabel({ from: '2026-09-01', to: '2026-09-12' }, now)).toBe('Sep 1 – Sep 12');
    expect(formatDateRangeLabel({ from: '2025-12-28', to: '2026-01-03' }, now)).toBe('Dec 28, 2025 – Jan 3, 2026');
  });

  it('spells out the long forms', () => {
    expect(formatLongDate('2026-09-12')).toBe('Saturday, September 12, 2026');
    expect(formatMonthLabel('2026-09-12')).toBe('September 2026');
  });

  it('lists weekday names in display order', () => {
    expect(weekdayNames(0).map((w) => w.long)[0]).toBe('Sunday');
    expect(weekdayNames(1).map((w) => w.narrow)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });
});
