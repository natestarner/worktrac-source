import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import DateCalendar from './DateCalendar';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { selectDate } from '../../utils/dateRange';

// The date picker: DateCalendar in a Modal, plus what a tap MEANS (dateRange.js#selectDate).
//
// A BOTTOM SHEET ON A PHONE, A CENTRED DIALOG EVERYWHERE ELSE. On a phone the sheet runs edge to
// edge, which is what buys each day a full 44px touch target on a 375px screen -- a centred dialog
// inside the scrim's 24px gutters leaves ~40px -- and it rises into thumb reach. On an iPad or a
// desktop a sheet would be a 420px strip glued to the bottom of a large screen, far from the
// calendar button at the top that opened it, so there it is a dialog. This is the split Material
// and iOS both make for compact vs. regular widths.
//
// SINGLE MODE COMMITS ON THE TAP. There is no Done: picking a day IS the decision, and a confirm
// step would be a second tap that decides nothing (the native iOS and Android pickers apply
// immediately too). The header X and Escape leave the filter exactly as it was. In range mode the
// first tap only anchors the range -- selectDate reports it incomplete, the sheet stays open for
// the second, and nothing is committed until both ends exist.
//
// `value` is the committed range or null. `onChange(range | null)` receives a complete range, or
// null from "Clear date".
const SHEET_MAX_WIDTH = 420;
const DIALOG_WIDTH = 360;

export default function DatePickerSheet({
  value,
  onChange,
  onClose,
  workoutCounts,
  minDate,
  maxDate,
  mode = 'single',
  title = 'Choose a date',
}) {
  const compact = useMediaQuery('(max-width: 599px)');
  // The range-mode half-selection, between its two taps. Never the committed filter.
  const [pending, setPending] = useState(null);

  function handleSelectDay(dateStr) {
    const { selection, complete } = selectDate({ mode, pending }, dateStr);
    if (!complete) {
      setPending(selection);
      return;
    }
    onChange(selection);
    onClose();
  }

  const hasMarks = !!workoutCounts && workoutCounts.size > 0;
  const awaitingEnd = mode === 'range' && pending?.to === null;

  return (
    <Modal
      title={title}
      onClose={onClose}
      align={compact ? 'bottom' : 'center'}
      width={compact ? SHEET_MAX_WIDTH : DIALOG_WIDTH}
    >
      <DateCalendar
        selection={pending ?? value}
        onSelectDay={handleSelectDay}
        initialFocusDate={value?.from}
        minDate={minDate}
        maxDate={maxDate}
        workoutCounts={workoutCounts}
      />
      {/* One quiet row under the grid: what the dots mean on the left, and -- only when there is
          something to clear -- a way to clear it on the right. min-height keeps the grid from
          shifting when Clear appears or goes. */}
      {(hasMarks || value || awaitingEnd) && (
        <div className="date-cal-footer">
          {awaitingEnd ? (
            <span className="date-cal-hint">Now pick the last day.</span>
          ) : (
            hasMarks && (
              <span className="date-cal-hint">
                <span className="date-cal-dot date-cal-dot--legend" aria-hidden="true" />
                Workout logged
              </span>
            )
          )}
          {value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null);
                onClose();
              }}
            >
              Clear date
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
