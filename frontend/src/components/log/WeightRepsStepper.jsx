// Reused by the live logging flow (large) and EditSetModal (slightly smaller).
export default function WeightRepsStepper({ label, value, onDec, onInc, onValueTap, size = 'lg' }) {
  const circle = size === 'lg' ? 44 : 40;
  const valueFont = size === 'lg' ? 28 : 22;

  return (
    <div
      className="stepper-row"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: size === 'lg' ? 20 : 18, minWidth: 0 }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-muted)' }}>{label}</div>
      <div className="stepper-controls" style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <button
          onClick={onDec}
          className="stepper-circle-btn"
          style={{
            width: circle,
            height: circle,
            borderRadius: 12,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--color-text)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          &minus;
        </button>
        {onValueTap ? (
          <button
            onClick={onValueTap}
            className="stepper-value"
            style={{
              minWidth: 88,
              textAlign: 'center',
              fontSize: valueFont,
              fontWeight: 700,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text)',
            }}
          >
            {value}
          </button>
        ) : (
          <div className="stepper-value" style={{ minWidth: circle + 24, textAlign: 'center', fontSize: valueFont, fontWeight: 700, color: 'var(--color-text)' }}>
            {value}
          </div>
        )}
        <button
          onClick={onInc}
          className="stepper-circle-btn"
          style={{
            width: circle,
            height: circle,
            borderRadius: 12,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--color-text)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
