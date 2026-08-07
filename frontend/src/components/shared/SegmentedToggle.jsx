// The pill-group segmented control used across Trends -- range (4wk/12wk/All) and the two metric
// switchers. Extracted from RangeToggle so all three read as one control rather than three
// lookalikes that can drift apart.
//
// Options are `{ label, value }`; `value` can be any type since selection compares by identity.
//
// `fill` stretches the control to its container with the pills sharing the width evenly. Use it
// once there are more than ~3 options: at intrinsic width, five pills overflow a 390px phone and
// the last one gets clipped mid-word, which reads as a broken layout rather than as "scroll me".
export default function SegmentedToggle({ options, value, onChange, ariaLabel, fill = false }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: fill ? 'flex' : 'inline-flex',
        width: fill ? '100%' : undefined,
        gap: 4,
        background: 'var(--color-subtle-bg)',
        borderRadius: 10,
        padding: 3,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.label}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={{
              flex: fill ? '1 1 0' : undefined,
              minWidth: 0,
              padding: fill ? '6px 4px' : '6px 14px',
              border: 'none',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.2,
              cursor: 'pointer',
              background: active ? 'var(--color-surface)' : 'transparent',
              color: active ? 'var(--color-accent)' : 'var(--color-muted)',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
