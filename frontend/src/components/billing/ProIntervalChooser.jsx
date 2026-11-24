import { useId } from 'react';

// Monthly vs yearly for the PRO card, owned by that card.
//
// ⚠️ PRO HAS ITS OWN INTERVAL, AND IT IS ON THE PRO CARD. It used to be the Plus card's PlanChooser,
// whose value silently also priced Pro and decided which bands Pro listed -- with nothing on the Pro
// card saying so. App Review (1.3.0, 2026-11-23, guideline 2.1(b)) could not find the monthly Pro
// subscriptions because the screen sat on Yearly, and Pro Unlimited, which the App Store sells
// monthly only, vanished outright. A trainer reading the Pro card should never need to know that a
// control in somebody else's card changes their price.
//
// Compact on purpose: the band select above it already carries the decision, and the price line
// below says what this choice costs -- repeating prices in the options would be a third copy.
//
// ⚠️ LABELS. Each radio's accessible name is "Pro monthly" / "Pro yearly", not the visible
// "Monthly" / "Yearly": the Plus card's radios are named "Monthly: $3.99 / month" and
// "Yearly: $29 / year ...", and "Monthly" is a substring of the first -- Playwright's default name
// match is a case-insensitive substring, so the bare word would make every existing selector for a
// Plus interval match two radios. "Pro monthly" neither contains nor is contained by either.
// The accessible name still contains the visible word (WCAG 2.5.3, label in name).
//
// `intervals` is what can actually be bought on this card (the store channel can lack one
// interval entirely); with only one there is nothing to choose and nothing is rendered.
const LABELS = { MONTH: 'Monthly', YEAR: 'Yearly' };

export default function ProIntervalChooser({ value, onChange, intervals }) {
  const headingId = useId();
  if (intervals.length < 2) return null;
  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <div id={headingId} style={headingStyle}>
        Pay monthly or yearly?
      </div>
      <div role="radiogroup" aria-labelledby={headingId} style={groupStyle}>
        {intervals.map((id) => {
          const selected = value === id;
          return (
            <label
              key={id}
              className="pressable"
              style={{
                ...optionStyle,
                border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: selected ? 'var(--color-subtle-bg)' : 'transparent',
                fontWeight: selected ? 'var(--weight-semibold)' : 'var(--weight-normal)',
              }}
            >
              <input
                type="radio"
                name="pro-billing-interval"
                value={id}
                checked={selected}
                onChange={() => onChange(id)}
                aria-label={`Pro ${LABELS[id].toLowerCase()}`}
                style={{ accentColor: 'var(--color-accent)' }}
              />
              <span>{LABELS[id]}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

const headingStyle = {
  color: 'var(--color-muted)',
  marginBottom: 'var(--space-1)',
};

const groupStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-2)',
};

const optionStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  minHeight: 44,
  padding: '0 var(--space-3)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};
