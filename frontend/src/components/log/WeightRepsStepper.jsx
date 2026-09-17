import { useState } from 'react';
import useHoldRepeat from '../../hooks/useHoldRepeat';

// Reused by the live logging flow (large) and EditSetModal (slightly smaller).
//
// Geometry lives on the .stepper-* classes in index.css rather than inline. That isn't
// cosmetic: the landscape layout has to shrink this control to fit two of them side by
// side, and while these values were inline it could only do that with three !important
// overrides. Keep new sizing in the stylesheet.
//
// The +/- keep their text glyphs rather than becoming icons like the rest of the app.
// They render identically on every platform and inherit colour and weight, so they were
// never part of the emoji problem -- and both the e2e helpers and the unit tests select
// these buttons by that text ('-' is U+2212, not a hyphen). Adding an aria-label here
// would replace the accessible name and break them; `title` leaves it alone, because text
// content outranks title in accessible-name computation.
//
// The value itself is a real <input>, not a styled button that used to open a modal
// keypad. A custom on-screen keypad made sense for one reason only: computePrefillDraft
// seeds this field with a carried-forward value, and a plain input puts the caret at the
// end of it, so typing a replacement APPENDED ("tap 135, type 225" produced 135225)
// instead of replacing it. Selecting the text on focus solves the same problem the
// platform's own way -- the first keystroke replaces a selection exactly like it does in
// any other text field -- so mobile keeps its native numeric keyboard and desktop never
// sees an unrequested overlay.
// `displayValue` is an optional pre-formatted string -- the Time stepper passes m:ss through it.
// It is what the field shows BOTH focused and unfocused, so the value never changes shape under
// you: you read "1:00", tap it, and get "1:00" selected, ready to be replaced or edited.
//
// `parse` is its inverse, turning whatever was typed back into a number. It exists because the two
// halves have to agree: showing m:ss while parsing with parseFloat would read "1:30" as 1. The
// Time stepper's parser accepts m:ss AND a bare second count, since a phone's numeric keypad has
// no colon on it (see utils/datetime.js#parseDuration).
//
// `onPick` is the Time field's third mode, and ONLY the Time field's: with it the value stops
// being typed and becomes a target that opens a min/sec wheel (DurationWheel). Weight and Reps
// never pass it, so nothing above changes for them -- which is the point. A numeric keypad
// expresses a weight or a rep count exactly; it cannot express m:ss at all, because it has no
// colon key. That gap is what `parse`'s permissiveness was papering over.
//
// It stays a real <input>, read-only, rather than becoming a <button>. A button's accessible
// name comes from its text content, so it would announce as "1:30" instead of "Time" -- and
// aria-label="Time" is what both test layers, the screen reader, and the ± buttons' titles all
// agree this control is called. Read-only also suppresses the mobile keyboard on tap, which is
// the whole reason to open a picker instead.
// Press-and-hold repeats the step (hooks/useHoldRepeat.js). Four decisions in that wiring are
// easy to "tidy" into bugs:
//
//   * `onClick` is untouched, and the repeat hangs off onPointerDown. A tap never reaches the hold
//     delay, so every existing e2e and unit test that clicks these buttons keeps meaning what it
//     meant. The click of a press that DID repeat is swallowed, or a held button always lands one
//     step past wherever the repeat decided to stop.
//   * No setPointerCapture. Touch pointers get implicit capture at pointerdown, a window-level
//     pointerup covers the mouse, and jsdom implements none of the capture API -- so adding it
//     would buy nothing on the target device and cost every unit test that presses a button.
//   * No pointerleave. Touch cannot report it (implicit capture suppresses boundary events), so
//     wiring it would give mouse and touch different stop conditions for one gesture. The repeat
//     runs until you lift.
//   * `atMin` marks the decrement with aria-disabled and a dimmed class, never the `disabled`
//     attribute. A disabled button fails Playwright's actionability check, and two specs
//     deliberately step a control all the way down to its bound; it is also what keeps the log
//     screen's tap-to-clear escape hatch working on Time, where the dim and the hold floor are
//     deliberately different answers (see .claude/rules/log-screen.md).
export default function WeightRepsStepper({
  label,
  value,
  displayValue,
  parse,
  onDec,
  onInc,
  onChange,
  onPick,
  size = 'lg',
  atMin = false,
  holdFloor = atMin,
  repeatOnHold = true,
}) {
  // Press-and-hold repeats, via the one hold mechanism (hooks/useHoldRepeat.js). It lives on the
  // primitive rather than at the two call sites so the log screen and EditSetModal cannot drift.
  //
  // `watch` is `value`, the number the step is expected to move; the hook uses it only to notice
  // that stepping has stopped achieving anything. `floor` is the caller's own answer to "another
  // step here would be pointless or unwanted" -- only the decrement has one, because nothing in
  // this app has an upper bound.
  const dec = useHoldRepeat({ onRepeat: onDec, watch: value, floor: holdFloor, enabled: repeatOnHold });
  const inc = useHoldRepeat({ onRepeat: onInc, watch: value, enabled: repeatOnHold });
  const isLarge = size === 'lg';
  // Base class always present -- the landscape rules and the e2e helpers both key off it.
  const btnClass = `stepper-circle-btn${isLarge ? '' : ' stepper-circle-btn-sm'} pressable`;
  const valueClass = `stepper-value${isLarge ? '' : ' stepper-value-sm'}${onPick ? ' stepper-value-pick' : ''}`;

  // Uncontrolled while focused (`draft`), controlled by `value` otherwise. A plain
  // controlled input re-renders on every keystroke with the PARSED value, which strips a
  // trailing "." the instant it's typed ("12." -> parseFloat -> 12 -> rendered back as
  // "12") and makes a decimal impossible to enter digit by digit. Committing only on
  // blur/Enter keeps typing free-form and mirrors the old keypad's explicit "Done".
  const [draft, setDraft] = useState(null);

  function commit(raw) {
    setDraft(null);
    onChange(parse ? parse(raw) : parseFloat(raw) || 0);
  }

  return (
    <div
      className="stepper-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        marginBottom: isLarge ? 'var(--space-5)' : 'var(--space-4)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-muted)' }}>{label}</div>
      <div className="stepper-controls" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
        <button
          type="button"
          onPointerDown={dec.onPointerDown}
          // Swallows the trailing click of a press that repeated -- otherwise a one-second hold
          // lands N repeats PLUS one more step on release, which on the Time control would walk
          // back off the floor the repeat just stopped at.
          onClick={(e) => {
            if (dec.wasRepeating()) return;
            onDec(e);
          }}
          title={`Decrease ${label}`}
          // aria-disabled, never `disabled`: a disabled button fails Playwright's actionability
          // check, and two existing specs deliberately step this control all the way down to its
          // bound. It also keeps the log screen's tap-to-clear escape hatch alive, which is the
          // one place the dim and the hold floor legitimately disagree.
          aria-disabled={atMin || undefined}
          className={`${btnClass}${atMin ? ' stepper-circle-btn--at-bound' : ''}`}
        >
          &minus;
        </button>
        {onPick ? (
          <input
            type="text"
            readOnly
            className={valueClass}
            value={displayValue ?? value ?? ''}
            placeholder="—"
            aria-label={label}
            aria-haspopup="dialog"
            onClick={onPick}
            // Space and Enter, because read-only or not this is now behaving as a button and
            // both are what a keyboard user will reach for. Space would otherwise scroll the
            // page out from under the control it was meant to open.
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick();
              }
            }}
          />
        ) : onChange ? (
          <input
            type="text"
            inputMode="decimal"
            className={valueClass}
            value={draft ?? displayValue ?? value ?? ''}
            placeholder="—"
            aria-label={label}
            // Select-all on focus is the whole trick -- see the header comment. The first
            // keystroke replaces the selection, which is exactly the "replace, don't
            // append" behaviour the keypad used to fake with a manual "fresh buffer" flag.
            onFocus={(e) => {
              // Seeds with displayValue so a formatted field (Time) stays formatted while you edit
              // it -- swapping "1:00" for "60" the instant you tap is a value changing shape under
              // your finger, and it silently teaches that only raw seconds are accepted.
              setDraft(String(displayValue ?? value ?? ''));
              e.target.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              // Commits via the blur handler above; Enter shouldn't submit anything else
              // on this screen (there's no surrounding <form>), just close the keyboard.
              if (e.key === 'Enter') e.target.blur();
            }}
          />
        ) : (
          <div className={valueClass}>{displayValue ?? value}</div>
        )}
        <button
          type="button"
          onPointerDown={inc.onPointerDown}
          onClick={(e) => {
            if (inc.wasRepeating()) return;
            onInc(e);
          }}
          title={`Increase ${label}`}
          className={btnClass}
        >
          +
        </button>
      </div>
    </div>
  );
}
