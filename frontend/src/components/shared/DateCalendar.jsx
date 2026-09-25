import { useEffect, useId, useRef, useState } from 'react';
import IconButton from './IconButton';
import { IconChevronLeft, IconChevronRight } from './icons';
import {
  addDays,
  addMonths,
  clampDateStr,
  endOfWeek,
  formatLongDate,
  formatMonthLabel,
  isDateInRange,
  monthGrid,
  normalizeRange,
  startOfMonth,
  startOfWeek,
  todayStr,
  weekdayNames,
} from '../../utils/dateRange';

// A month-at-a-time calendar grid, following the WAI-ARIA Authoring Practices "Date Picker Dialog"
// pattern. Controlled for the SELECTION (the caller owns what is picked and what a tap means --
// see DatePickerSheet and dateRange.js#selectDate); it owns only which month is on screen and
// which day holds keyboard focus.
//
// Days are local 'YYYY-MM-DD' strings throughout -- see dateRange.js's header for why never Dates.
//
// KEYBOARD (the APG set): arrows move a day / a week, Home/End go to the start/end of the week,
// PageUp/PageDown change month, Shift+PageUp/PageDown change year, Enter/Space pick (native
// <button> behaviour). Focus is ROVING: exactly one day is in the Tab order, so Tab moves between
// the month controls, the grid and the footer instead of walking through 30 days.
//
// TOUCH: a horizontal swipe on the grid pages months, the gesture every phone calendar teaches.
// The chevrons remain the primary control and the only one announced -- the swipe is a shortcut,
// never the only way.
//
// `selection` is a range `{ from, to }`; in a half-built range-mode draft `to` is null. The grid
// draws a range band whenever from !== to, so a range picker later needs nothing new here.
//
// `workoutCounts` (Map<dateStr, number>) puts a dot under every day something was logged, and the
// count in that day's accessible name -- so the calendar answers "which days did I train?" before
// a single tap, instead of making someone guess a date and hit an empty result.
export default function DateCalendar({
  selection,
  onSelectDay,
  initialFocusDate,
  minDate,
  maxDate,
  workoutCounts,
  weekStartsOn = 0,
}) {
  const monthLabelId = useId();
  const [focusedDate, setFocusedDate] = useState(() =>
    clampDateStr(initialFocusDate || selection?.from || todayStr(), minDate, maxDate),
  );
  const displayMonth = startOfMonth(focusedDate);
  // Which way the last month change went, so the new month slides in from the side the person
  // paged toward. Purely presentational; the global reduced-motion rule collapses it.
  const [direction, setDirection] = useState(null);
  const gridRef = useRef(null);
  // Move DOM focus only after a KEYBOARD move. Moving it on every render would steal focus from
  // the month chevrons while someone clicks through months, and yank it into the grid on open
  // (Modal's own autofocus handles the open, via data-autofocus below).
  const moveFocusRef = useRef(false);
  const touchStartRef = useRef(null);

  const today = todayStr();
  const range = normalizeRange(selection?.to === null ? { from: selection.from, to: selection.from } : selection);
  const minMonth = minDate ? startOfMonth(minDate) : null;
  const maxMonth = maxDate ? startOfMonth(maxDate) : null;
  const canGoPrev = !minMonth || displayMonth > minMonth;
  const canGoNext = !maxMonth || displayMonth < maxMonth;

  useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    gridRef.current?.querySelector(`[data-date="${focusedDate}"]`)?.focus({ preventScroll: true });
  }, [focusedDate]);

  function moveTo(next, { focus = false } = {}) {
    const clamped = clampDateStr(next, minDate, maxDate);
    if (clamped === focusedDate) return;
    if (startOfMonth(clamped) !== displayMonth) setDirection(clamped > focusedDate ? 'next' : 'prev');
    moveFocusRef.current = focus;
    setFocusedDate(clamped);
  }

  function pageMonth(delta) {
    moveTo(addMonths(focusedDate, delta));
  }

  function onKeyDown(event) {
    const moves = {
      ArrowLeft: () => addDays(focusedDate, -1),
      ArrowRight: () => addDays(focusedDate, 1),
      ArrowUp: () => addDays(focusedDate, -7),
      ArrowDown: () => addDays(focusedDate, 7),
      Home: () => startOfWeek(focusedDate, weekStartsOn),
      End: () => endOfWeek(focusedDate, weekStartsOn),
      PageUp: () => addMonths(focusedDate, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusedDate, event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveTo(move(), { focus: true });
  }

  function onTouchStart(event) {
    const t = event.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  }

  function onTouchEnd(event) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const t = event.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Deliberately horizontal and deliberately long: a thumb tapping a day drifts a few px, and a
    // vertical drag is the sheet's own scroll.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && canGoNext) pageMonth(1);
    if (dx > 0 && canGoPrev) pageMonth(-1);
  }

  const weekdays = weekdayNames(weekStartsOn);
  const weeks = monthGrid(displayMonth, weekStartsOn);

  return (
    <div className="date-cal">
      <div className="date-cal-header">
        <IconButton
          icon={IconChevronLeft}
          label="Previous month"
          onClick={() => pageMonth(-1)}
          disabled={!canGoPrev}
        />
        {/* Live, so paging with the chevrons or PageUp/PageDown announces where you landed. */}
        <h3 id={monthLabelId} className="date-cal-month" aria-live="polite">
          {formatMonthLabel(displayMonth)}
        </h3>
        <IconButton icon={IconChevronRight} label="Next month" onClick={() => pageMonth(1)} disabled={!canGoNext} />
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={monthLabelId}
        className="date-cal-grid"
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <thead>
          <tr>
            {weekdays.map((w, i) => (
              <th key={i} scope="col" abbr={w.long} className="date-cal-weekday">
                <span aria-hidden="true">{w.narrow}</span>
                <span className="sr-only">{w.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody key={displayMonth} className="date-cal-body" data-direction={direction || undefined}>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, di) => {
                if (!date) {
                  // The spacer is sized exactly like a day button, so a row with no days in it
                  // (the padding weeks that keep the grid at six rows) is still a full row tall.
                  return (
                    <td key={di} role="gridcell" className="date-cal-cell">
                      <span className="date-cal-spacer" aria-hidden="true" />
                    </td>
                  );
                }
                const disabled = (minDate && date < minDate) || (maxDate && date > maxDate);
                const selected = !!range && isDateInRange(date, range);
                const isStart = !!range && date === range.from;
                const isEnd = !!range && date === range.to;
                const count = workoutCounts?.get(date) || 0;
                const isToday = date === today;
                const focusable = date === focusedDate;
                return (
                  <td
                    key={di}
                    role="gridcell"
                    aria-selected={selected}
                    className="date-cal-cell"
                    // The band behind a multi-day range: drawn on the cell, so it runs edge to
                    // edge between the start and end circles. Nothing sets it for a single day.
                    data-band={range && range.from !== range.to && selected ? (isStart ? 'start' : isEnd ? 'end' : 'mid') : undefined}
                  >
                    <button
                      type="button"
                      className="date-cal-day"
                      data-date={date}
                      data-autofocus={focusable ? '' : undefined}
                      data-selected={isStart || isEnd ? '' : undefined}
                      data-today={isToday ? '' : undefined}
                      tabIndex={focusable ? 0 : -1}
                      disabled={disabled}
                      aria-pressed={isStart || isEnd}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={dayLabel(date, { count, isToday })}
                      onClick={() => {
                        setFocusedDate(date);
                        onSelectDay(date);
                      }}
                    >
                      <span className="date-cal-num" aria-hidden="true">
                        {Number(date.slice(8))}
                      </span>
                      {count > 0 && <span className="date-cal-dot" aria-hidden="true" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// "Saturday, September 12, 2026, 2 workouts, today". The count is what the dot means, so a
// screen-reader user gets the same "which days did I train" answer a sighted one gets at a glance.
function dayLabel(date, { count, isToday }) {
  let label = formatLongDate(date);
  if (count === 1) label += ', 1 workout';
  else if (count > 1) label += `, ${count} workouts`;
  if (isToday) label += ', today';
  return label;
}
