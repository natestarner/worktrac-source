import { useState } from 'react';

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
export default function WeightRepsStepper({ label, value, displayValue, parse, onDec, onInc, onChange, size = 'lg' }) {
  const isLarge = size === 'lg';
  // Base class always present -- the landscape rules and the e2e helpers both key off it.
  const btnClass = `stepper-circle-btn${isLarge ? '' : ' stepper-circle-btn-sm'} pressable`;
  const valueClass = `stepper-value${isLarge ? '' : ' stepper-value-sm'}`;

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
        <button type="button" onClick={onDec} title={`Decrease ${label}`} className={btnClass}>
          &minus;
        </button>
        {onChange ? (
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
        <button type="button" onClick={onInc} title={`Increase ${label}`} className={btnClass}>
          +
        </button>
      </div>
    </div>
  );
}
