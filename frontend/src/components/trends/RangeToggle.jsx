// "All time" is capped at StatsService.MAX_WEEKS (260) server-side, so a household with
// years of history never gets an unbounded response -- 260 here just has to match that cap.
export const RANGE_OPTIONS = [
  { label: '4wk', weeks: 4 },
  { label: '12wk', weeks: 12 },
  { label: 'All', weeks: 260 },
];

export default function RangeToggle({ weeks, onChange }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, background: 'var(--color-subtle-bg)', borderRadius: 10, padding: 3 }}>
      {RANGE_OPTIONS.map((opt) => {
        const active = opt.weeks === weeks;
        return (
          <button
            key={opt.label}
            onClick={() => onChange(opt.weeks)}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 700,
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
