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
export default function WeightRepsStepper({ label, value, onDec, onInc, onValueTap, size = 'lg' }) {
  const isLarge = size === 'lg';
  // Base class always present -- the landscape rules and the e2e helpers both key off it.
  const btnClass = `stepper-circle-btn${isLarge ? '' : ' stepper-circle-btn-sm'} pressable`;
  const valueClass = `stepper-value${isLarge ? '' : ' stepper-value-sm'}`;

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
        {onValueTap ? (
          <button
            type="button"
            onClick={onValueTap}
            aria-label={`${label}: ${value}. Tap to enter an exact value`}
            className={`${valueClass} pressable`}
          >
            {value}
          </button>
        ) : (
          <div className={valueClass}>{value}</div>
        )}
        <button type="button" onClick={onInc} title={`Increase ${label}`} className={btnClass}>
          +
        </button>
      </div>
    </div>
  );
}
