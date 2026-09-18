// A labelled native <select>.
//
// Native rather than a custom listbox, and deliberately not SegmentedToggle: on a phone iOS and
// Android render this as their own full-height wheel/sheet, which is a better one-handed target
// mid-workout than five pills squeezed into 390px. SegmentedToggle stays right where the labels are
// short and the choice is flicked between often (the Trends metric switchers); a select is right
// where the labels are long and the choice is set-and-forget.
//
// Extracted when the PRs board grew a second dropdown beside its sort. Four call sites had already
// hand-rolled this recipe with four different paddings, which is exactly the drift
// frontend-core.md's "reach for a primitive before writing a style object" rule exists to stop.
//
// fontSize MUST stay 16px: below that, iOS Safari zooms the viewport on focus and the person has to
// pinch back out mid-workout. Two e2e specs assert the computed value on other inputs.
const selectStyle = {
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 16,
  fontWeight: 600,
  // 44px touch target -- this app is used on an iPad mid-workout.
  minHeight: 44,
};

const labelStyle = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

export default function Select({ id, label, value, onChange, options, fullWidth = false, style, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, ...(fullWidth ? { width: '100%' } : {}) }}>
      {label && (
        <label htmlFor={id} style={labelStyle}>
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...selectStyle, ...(fullWidth ? { width: '100%', boxSizing: 'border-box' } : {}), ...style }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {/* Slot for a trailing control that belongs to this field -- the PRs board hangs its
          ChartHelp "?" here so the explanation sits with the picker it explains. */}
      {children}
    </div>
  );
}
