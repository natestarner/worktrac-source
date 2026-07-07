// Validated 8-slot categorical palette (dataviz skill, palette.md), defined as
// --chart-cat-1..8 in index.css so light/dark swap in one place. Worst adjacent CVD sits
// at the accessibility floor, so identity must never rely on color alone here -- that's
// why every segment always ships a visible name+percent label rather than a hover-only
// tooltip (the "relief rule" for the three low-contrast slots among these).
const CATEGORY_COLORS = [
  'var(--chart-cat-1)',
  'var(--chart-cat-2)',
  'var(--chart-cat-3)',
  'var(--chart-cat-4)',
  'var(--chart-cat-5)',
  'var(--chart-cat-6)',
  'var(--chart-cat-7)',
  'var(--chart-cat-8)',
];

export default function CategoryBalanceChart({ breakdown }) {
  if (breakdown.length === 0) {
    return (
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', marginBottom: 4 }}>Category balance &middot; last 30 days</div>
        <div style={{ fontSize: 14, color: 'var(--color-faint)' }}>No sets logged in the last 30 days.</div>
      </div>
    );
  }

  // Beyond 8 slots, fold the tail into "Other" rather than generating a 9th hue (a
  // generated hue is indistinguishable from an existing one under CVD).
  const shown = breakdown.slice(0, 8);
  const rest = breakdown.slice(8);
  const otherPct = rest.reduce((sum, c) => sum + c.pct, 0);
  const otherCount = rest.reduce((sum, c) => sum + c.setCount, 0);

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', marginBottom: 12 }}>Category balance &middot; last 30 days</div>

      <div style={{ display: 'flex', height: 20, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
        {shown.map((c, i) => (
          <div
            key={c.category}
            style={{
              flexGrow: c.pct,
              flexBasis: 0,
              minWidth: c.pct > 0 ? 3 : 0,
              background: CATEGORY_COLORS[i],
            }}
          />
        ))}
        {rest.length > 0 && <div style={{ flexGrow: otherPct, flexBasis: 0, background: 'var(--color-faint)' }} />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {shown.map((c, i) => (
          <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: CATEGORY_COLORS[i], flexShrink: 0 }} />
            <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{c.category}</span>
            <span style={{ color: 'var(--color-muted)', marginLeft: 'auto' }}>
              {c.pct}% &middot; {c.setCount} set{c.setCount === 1 ? '' : 's'}
            </span>
          </div>
        ))}
        {rest.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--color-faint)', flexShrink: 0 }} />
            <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>Other</span>
            <span style={{ color: 'var(--color-muted)', marginLeft: 'auto' }}>
              {Math.round(otherPct)}% &middot; {otherCount} set{otherCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
