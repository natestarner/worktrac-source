// Calendar-day arithmetic and the date-range filter value, for History's "Search by date".
//
// EVERY DAY HERE IS A LOCAL 'YYYY-MM-DD' STRING, never a Date or an instant. A calendar day is not
// a moment: the same instant is two different days in two time zones, and a midnight Date walks
// into the previous day the first time anything converts it to UTC. Strings sidestep all of it --
// they compare correctly with plain `<` / `>` (fixed-width, most-significant first), they are
// exactly what toLocalDateStr() already produces from a session's startedAt, and they survive
// JSON untouched. A Date is only ever built transiently, at NOON, to do month/weekday arithmetic:
// noon is hours clear of every DST transition, so setDate() can never land on the wrong day.
//
// THE FILTER VALUE IS ALWAYS A RANGE: `{ from, to }`, inclusive at both ends, or null for "no
// date filter". A single day is simply `from === to`. A WORKOUT is a range too (the days it ran
// across -- see exerciseFilter.js#sessionDaySpan), and it matches a search when the two ranges
// overlap. Nothing downstream -- the filter, the chip,
// the calendar's highlighting -- knows or cares whether the person picked one day or several,
// which is what keeps a future range picker a change to the picker alone (see selectDate's
// 'range' mode, already implemented and tested, just not yet offered in the UI).

import { toLocalDateStr } from './datetime';

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function dateStrFromParts(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function parts(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, monthIndex: m - 1, day: d };
}

// The transient Date, at local noon -- see the header for why noon.
function noonDate(dateStr) {
  const { year, monthIndex, day } = parts(dateStr);
  return new Date(year, monthIndex, day, 12);
}

function strFromDate(d) {
  return dateStrFromParts(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isValidDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Round-trips only if it names a real day: '2026-02-30' becomes March 2nd and fails this.
  return strFromDate(noonDate(value)) === value;
}

export function todayStr(now = new Date()) {
  return toLocalDateStr(now.toISOString());
}

export function addDays(dateStr, days) {
  const d = noonDate(dateStr);
  d.setDate(d.getDate() + days);
  return strFromDate(d);
}

// Same day-of-month in the target month, clamped to that month's length -- so Jan 31 + 1 month is
// Feb 28/29, not March 3rd. This is what PageUp/PageDown in the calendar move by, and a person
// paging months from the 31st expects to stay at the end of the month, not skip one.
export function addMonths(dateStr, months) {
  const { year, monthIndex, day } = parts(dateStr);
  const target = new Date(year, monthIndex + months, 1, 12);
  const clampedDay = Math.min(day, daysInMonth(target.getFullYear(), target.getMonth()));
  return dateStrFromParts(target.getFullYear(), target.getMonth(), clampedDay);
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0, 12).getDate();
}

export function startOfMonth(dateStr) {
  const { year, monthIndex } = parts(dateStr);
  return dateStrFromParts(year, monthIndex, 1);
}

export function endOfMonth(dateStr) {
  const { year, monthIndex } = parts(dateStr);
  return dateStrFromParts(year, monthIndex, daysInMonth(year, monthIndex));
}

// 0 = Sunday .. 6 = Saturday, matching Date#getDay.
export function dayOfWeek(dateStr) {
  return noonDate(dateStr).getDay();
}

export function startOfWeek(dateStr, weekStartsOn = 0) {
  const offset = (dayOfWeek(dateStr) - weekStartsOn + 7) % 7;
  return addDays(dateStr, -offset);
}

export function endOfWeek(dateStr, weekStartsOn = 0) {
  return addDays(startOfWeek(dateStr, weekStartsOn), 6);
}

export function clampDateStr(dateStr, min, max) {
  if (min && dateStr < min) return min;
  if (max && dateStr > max) return max;
  return dateStr;
}

// The month's days laid out as calendar weeks: an array of 7-slot rows, where a slot is either a
// day of THIS month or null (the leading/trailing gap).
//
// ALWAYS SIX ROWS -- the most any month can need -- padded with empty weeks. A month spans four,
// five or six calendar weeks, and a grid that tracked that changed height on every page. The
// phone sheet is anchored to the BOTTOM of the screen (and the dialog to the centre), so a height
// change moved its top edge: the month name and the chevrons jumped up or down a row's height
// directly under the thumb paging with them. A constant height is what keeps the next tap where
// the last one was, and it is what the iOS and Material calendars do for the same reason.
export const CALENDAR_WEEKS = 6;

export function monthGrid(monthStr, weekStartsOn = 0) {
  const first = startOfMonth(monthStr);
  const { year, monthIndex } = parts(first);
  const lead = (dayOfWeek(first) - weekStartsOn + 7) % 7;
  const total = daysInMonth(year, monthIndex);

  const slots = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= total; day += 1) slots.push(dateStrFromParts(year, monthIndex, day));
  while (slots.length < CALENDAR_WEEKS * 7) slots.push(null);

  const weeks = [];
  for (let i = 0; i < slots.length; i += 7) weeks.push(slots.slice(i, i + 7));
  return weeks;
}

// ---- The range value ------------------------------------------------------------------------

export function singleDayRange(dateStr) {
  return { from: dateStr, to: dateStr };
}

// Orders the ends, so a range picked backwards (a later day tapped first) is still a valid range.
export function normalizeRange(range) {
  if (!range?.from) return null;
  const to = range.to ?? range.from;
  return range.from <= to ? { from: range.from, to } : { from: to, to: range.from };
}

export function isSingleDay(range) {
  return !!range && range.from === range.to;
}

export function isDateInRange(dateStr, range) {
  const r = normalizeRange(range);
  return !!r && dateStr >= r.from && dateStr <= r.to;
}

// Whether two day ranges share at least one day. The standard interval test -- each starts on or
// before the day the other ends -- which, unlike "either END falls inside", also catches a span
// that encloses the other entirely.
export function rangesOverlap(a, b) {
  const x = normalizeRange(a);
  const y = normalizeRange(b);
  return !!x && !!y && x.from <= y.to && y.from <= x.to;
}

// Every day from `from` to `to` inclusive. `maxDays` is a backstop against a malformed span
// (a corrupt or hand-edited timestamp), so a caller building per-day counts can never spin
// through years of days; the real spans fed in here are a day or two.
export function eachDay(from, to, maxDays = 366) {
  const days = [];
  for (let d = from; d <= to && days.length < maxDays; d = addDays(d, 1)) days.push(d);
  return days;
}

// What tapping a day does to the current selection. Returns the next selection and whether it is
// COMPLETE -- i.e. whether the picker should now commit and close.
//
//   'single': every tap is a whole selection, complete at once.
//   'range':  the first tap anchors a new range (incomplete: the picker stays open for the other
//             end); the second tap closes it, in either direction. A third tap starts over. This
//             is the familiar hotel/airline picker, and it is here -- tested -- so offering ranges
//             later is a `mode` prop on the sheet, not new selection logic.
//
// `pending` is the half-built range between the two range-mode taps. It is the picker's own draft,
// never the committed filter value: a range with no second end must not filter History to one day
// while the person is still choosing.
export function selectDate({ mode = 'single', pending = null }, dateStr) {
  if (mode === 'range') {
    if (pending && pending.to === null) {
      return { selection: normalizeRange({ from: pending.from, to: dateStr }), complete: true };
    }
    return { selection: { from: dateStr, to: null }, complete: false };
  }
  return { selection: singleDayRange(dateStr), complete: true };
}

// ---- Labels -------------------------------------------------------------------------------

const MONTH_DAY = { month: 'short', day: 'numeric' };
const MONTH_DAY_YEAR = { month: 'short', day: 'numeric', year: 'numeric' };

function label(dateStr, opts) {
  return noonDate(dateStr).toLocaleDateString('en-US', opts);
}

// The chip's text. The year appears only when it isn't this year, because nearly every search is
// for something recent and "Sep 12, 2026" in September 2026 is a longer chip saying nothing more.
//   single day:  "Sat, Sep 12"          (weekday included: "what did I do on Saturday?")
//   range:       "Sep 1 – Sep 12"       "Dec 28, 2025 – Jan 3, 2026"
export function formatDateRangeLabel(range, now = new Date()) {
  const r = normalizeRange(range);
  if (!r) return '';
  const thisYear = String(now.getFullYear());
  const needsYear = r.from.slice(0, 4) !== thisYear || r.to.slice(0, 4) !== thisYear;
  if (r.from === r.to) {
    return label(r.from, needsYear ? { weekday: 'short', ...MONTH_DAY_YEAR } : { weekday: 'short', ...MONTH_DAY });
  }
  const opts = needsYear ? MONTH_DAY_YEAR : MONTH_DAY;
  return `${label(r.from, opts)} – ${label(r.to, opts)}`;
}

// The unabbreviated day, for accessible names and empty-state copy: "Saturday, September 12, 2026".
export function formatLongDate(dateStr) {
  return label(dateStr, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatMonthLabel(monthStr) {
  return label(startOfMonth(monthStr), { month: 'long', year: 'numeric' });
}

// Narrow + long weekday names in display order, for the calendar's column headers.
export function weekdayNames(weekStartsOn = 0) {
  // 2026-09-06 is a Sunday; any known Sunday works.
  const sunday = '2026-09-06';
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(sunday, (weekStartsOn + i) % 7);
    return { narrow: label(d, { weekday: 'narrow' }), long: label(d, { weekday: 'long' }) };
  });
}
