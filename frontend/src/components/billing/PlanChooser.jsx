import { INTERVAL_ORDER, PRICING } from './planCopy';

// Monthly vs yearly, as a real radio group rather than two styled divs: arrow keys move between
// options, the group has one tab stop, and a screen reader announces "2 of 2 selected". Two
// buttons with aria-pressed would announce as two unrelated toggles, which is not what this is.
//
// Yearly is pre-selected by the caller (see planCopy.INTERVAL_ORDER).
//
// `prices` (store channel only): ({ plan, interval }) -> the store's own price string. The web's
// equivalent-per-month and savings lines are dropped there: they are arithmetic on the web prices,
// and the store's are rounded to its own price points.
export default function PlanChooser({ value, onChange, prices = null }) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      style={{ display: 'grid', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}
    >
      {INTERVAL_ORDER.map((id) => {
        const web = PRICING[id];
        const storePrice = prices ? prices({ plan: 'PLUS', interval: id }) : null;
        const option = prices
          ? { ...web, price: `${storePrice} / ${id === 'YEAR' ? 'year' : 'month'}`, equivalent: null, savings: null }
          : web;
        if (prices && !storePrice) return null;
        const selected = value === id;
        return (
          <label
            key={id}
            className="pressable"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              minHeight: 44,
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: selected ? 'var(--color-subtle-bg)' : 'transparent',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="billing-interval"
              value={id}
              checked={selected}
              onChange={() => onChange(id)}
              style={{ accentColor: 'var(--color-accent)' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span style={{ fontWeight: 'var(--weight-semibold)' }}>
                {option.label}: {option.price}
              </span>
              {option.equivalent && (
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
                  {option.equivalent}
                </span>
              )}
            </span>
            {option.savings && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-bold)',
                  color: 'var(--color-accent-text)',
                  whiteSpace: 'nowrap',
                }}
              >
                {option.savings}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
