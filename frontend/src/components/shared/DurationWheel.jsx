import { useCallback, useEffect, useId, useRef } from 'react';
import { formatRestTime } from '../../utils/datetime';

// Two scroll-snap columns, minutes and seconds -- the countdown-timer wheel that every
// platform's own duration control is (iOS UIDatePicker .countDownTimer, Android's paired
// NumberPickers). There is no native web equivalent to reach for: <input type="time"> is
// time-of-DAY -- it means "3:45 PM", renders AM/PM in some locales -- and there is no
// <input type="duration"> at all.
//
// Why a picker here when the Weight and Reps steppers deliberately DON'T have one: m:ss is a
// composite value, and a phone's numeric keypad has no colon key. That is not a styling
// complaint, it is why utils/datetime.js#parseDuration had to be made permissive enough to
// accept a bare second count -- the field displayed "1:30" while the only thing a thumb could
// physically type was "90", so entering an exact time meant doing the arithmetic yourself.
// Weight and Reps are plain numbers that a numeric keypad expresses perfectly, so they keep
// their text inputs and never get this. See .claude/rules/log-screen.md.
//
// A previous NumericKeypad modal was removed partly because it "pops an unrequested keypad over
// a mouse-and-keyboard session". That objection is answered here rather than ignored: every
// column is a real listbox driven by arrow keys, Home/End, and DIGIT TYPEAHEAD -- typing 4 then
// 5 in the seconds column selects 45. Tab in, type, Enter is at least as fast as the textbox
// this replaces, and it is the path the e2e helper drives (scroll-driving a snap container from
// a test is inherently flaky; typing is deterministic).
//
// Presentational and fully controlled: it takes a number of seconds and emits a number of
// seconds. Formatting stays in formatRestTime, which is the app's single seconds -> clock
// formatter (the rest timer, the hold timer, the Time field and every set row all share it).

const MINUTE_MAX = 59;
const SECOND_MAX = 59;

// How long a digit stays "open" for a second digit to join it: type 4 then 5 inside this window
// and you get 45; wait longer and the 5 starts over as 5. Matches the listbox typeahead idiom.
const TYPEAHEAD_MS = 1000;

// A momentum fling fires scroll events for a while after the finger leaves. Reading the centred
// row on every one of those would emit a value per frame; this waits for the column to actually
// come to rest. Long enough not to fire mid-fling, short enough that lifting your thumb and
// immediately tapping Done still commits what you're looking at.
const SETTLE_MS = 120;

const MINUTE_OPTIONS = Array.from({ length: MINUTE_MAX + 1 }, (_, i) => i);
const SECOND_OPTIONS = Array.from({ length: SECOND_MAX + 1 }, (_, i) => i);

function clampIndex(value, max) {
  return Math.min(max, Math.max(0, value));
}

// One scrolling column. Snap does the physics; this only translates between "which row is
// centred" and a number, in both directions.
function WheelColumn({ label, caption, options, value, onSelect, idBase }) {
  const scrollerRef = useRef(null);
  const settleTimerRef = useRef(null);
  // Set while WE are the ones moving the scroller (an external value change, or a keypress that
  // already emitted its own onSelect). Without it the scroll handler reads back the position we
  // just wrote and re-emits it, which fights the parent for control of the value.
  const selfScrollingRef = useRef(false);
  const typeaheadRef = useRef({ buffer: '', at: 0 });

  // Measured rather than hardcoded: the row height is a token in index.css and the landscape
  // block shrinks it, so a literal here would silently desync from the stylesheet.
  const rowHeight = useCallback(() => {
    const scroller = scrollerRef.current;
    const row = scroller?.querySelector('[data-wheel-option]');
    return row?.offsetHeight || 0;
  }, []);

  const scrollToIndex = useCallback(
    (index, behavior) => {
      const scroller = scrollerRef.current;
      const height = rowHeight();
      if (!scroller || !height) return;
      const top = index * height;
      if (Math.abs(scroller.scrollTop - top) < 1) return;
      selfScrollingRef.current = true;
      scroller.scrollTo({ top, behavior });
    },
    [rowHeight],
  );

  // Keep the column parked on whatever the parent says the value is -- ± buttons, the hold
  // timer's Stop, and this column's own keyboard handler all arrive through here. jsdom
  // implements neither smooth scrolling nor scroll-snap, so this is also what makes the
  // component testable at all: the assertion is on aria-selected, not on scrollTop.
  useEffect(() => {
    scrollToIndex(clampIndex(value, options.length - 1), 'smooth');
  }, [value, options.length, scrollToIndex]);

  // Park without animating on first paint -- a wheel that visibly scrolls up from 0 as the sheet
  // opens reads as the value changing on its own.
  useEffect(() => {
    scrollToIndex(clampIndex(value, options.length - 1), 'auto');
    // Mount only; the effect above owns every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(settleTimerRef.current), []);

  function handleScroll() {
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      const scroller = scrollerRef.current;
      const height = rowHeight();
      if (!scroller || !height) return;
      if (selfScrollingRef.current) {
        selfScrollingRef.current = false;
        return;
      }
      const index = clampIndex(Math.round(scroller.scrollTop / height), options.length - 1);
      if (index !== value) onSelect(index);
    }, SETTLE_MS);
  }

  function commit(next) {
    const index = clampIndex(next, options.length - 1);
    // Scroll ourselves rather than waiting for the value effect: if the clamp means the number
    // didn't change (already at 0, pressing Down), no re-render is coming to move us back.
    selfScrollingRef.current = true;
    scrollToIndex(index, 'smooth');
    if (index !== value) onSelect(index);
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      commit(value + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      commit(value - 1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      commit(value + 10);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      commit(value - 10);
    } else if (event.key === 'Home') {
      event.preventDefault();
      commit(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      commit(options.length - 1);
    } else if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      const now = Date.now();
      const state = typeaheadRef.current;
      const fresh = now - state.at > TYPEAHEAD_MS;
      const candidate = fresh ? event.key : state.buffer + event.key;
      // "4" then "5" is 45. If the pair overflows the column (e.g. "9" then "9"), the second
      // digit starts a new number instead of being swallowed -- the same thing a native picker
      // does, and it keeps every digit meaningful.
      const asNumber = Number(candidate);
      const accepted = asNumber <= options.length - 1 ? candidate : event.key;
      state.buffer = accepted;
      state.at = now;
      commit(Number(accepted));
    }
  }

  const activeId = `${idBase}-${clampIndex(value, options.length - 1)}`;

  return (
    <div className="duration-wheel-col">
      <div
        ref={scrollerRef}
        className="duration-wheel-scroller"
        role="listbox"
        tabIndex={0}
        aria-label={label}
        aria-activedescendant={activeId}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        // Leaving the column ends the number you were typing. Conventional for a listbox
        // typeahead, and it means "4" "5" can never join across a gap where you went and did
        // something else -- so what a given keystroke does depends only on this visit.
        onBlur={() => {
          typeaheadRef.current = { buffer: '', at: 0 };
        }}
      >
        {options.map((option) => (
          <div
            key={option}
            id={`${idBase}-${option}`}
            data-wheel-option=""
            role="option"
            aria-selected={option === value}
            className={`duration-wheel-option${option === value ? ' is-selected' : ''}`}
            // Tapping a visible-but-off-centre row is the other half of the gesture: snap then
            // carries it to the middle, so it behaves like a short flick.
            onClick={() => commit(option)}
          >
            {option}
          </div>
        ))}
      </div>
      {/* aria-hidden because the column's own aria-label already says "Minutes"/"Seconds" in
          full; this is the visual shorthand only, and reading both is just noise. */}
      <div className="duration-wheel-caption" aria-hidden="true">
        {caption}
      </div>
    </div>
  );
}

// Deliberately a pure editor over 0:00-59:59 with NO minimum of its own. The floor that keeps a
// 0-second hold off the wire (durationSeconds is @Min(1); a 400 is a definitive 4xx, which
// discards the durable write for good) belongs on the COMMIT -- DurationPickerSheet's Done and
// EditSetModal's Save -- not here. Clamping mid-scroll would mean the wheel snapping back from
// 0:00 to 0:01 under a finger that is still moving, and it would make Clear a lie: the control
// would refuse to show the empty state the button claims to produce.
export default function DurationWheel({ valueSeconds, onChange, className = '' }) {
  const idBase = useId();
  const safeValue = Math.max(0, Math.round(valueSeconds || 0));
  const minutes = Math.min(MINUTE_MAX, Math.floor(safeValue / 60));
  const seconds = safeValue % 60;

  function emit(nextMinutes, nextSeconds) {
    onChange(nextMinutes * 60 + nextSeconds);
  }

  return (
    <div className={`duration-wheel${className ? ` ${className}` : ''}`}>
      <div className="duration-wheel-cols">
        {/* Painted behind the columns, so the numbers themselves stay full-contrast on top of
            it. Marks the committed row the way the native control's selection band does --
            without it a snap wheel gives you no fixed point to read against. */}
        <div className="duration-wheel-band" aria-hidden="true" />
        <WheelColumn
          label="Minutes"
          caption="min"
          idBase={`${idBase}-m`}
          options={MINUTE_OPTIONS}
          value={minutes}
          onSelect={(next) => emit(next, seconds)}
        />
        <div className="duration-wheel-colon" aria-hidden="true">
          :
        </div>
        <WheelColumn
          label="Seconds"
          caption="sec"
          idBase={`${idBase}-s`}
          options={SECOND_OPTIONS}
          value={seconds}
          onSelect={(next) => emit(minutes, next)}
        />
      </div>
      {/* A screen reader moving the minutes column otherwise hears "1" with no sense of the
          total it just built. Announces the whole time in the same m:ss shape the field shows. */}
      <div className="duration-wheel-live" role="status" aria-live="polite">
        {formatRestTime(safeValue)}
      </div>
    </div>
  );
}
