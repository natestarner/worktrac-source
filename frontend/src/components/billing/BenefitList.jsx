import { PLUS_BENEFITS } from './planCopy';

// A tier's benefits as a ticked list: the billing screen's plan cards and the welcome after a
// checkout (PlusCelebration) draw the SAME list, from planCopy, so the screen someone paid on and
// the moment they arrive cannot describe the tier differently. Moved out of BillingTab for the
// second caller (TestFlight 1.4, 2026-11-25: the welcome named three unlocks in a sentence).
//
// Deliberately the same treatment as the marketing site's pricing card -- an accent tick per
// benefit -- so the page someone read before signing up and the screen they upgrade on feel like
// one product rather than two.
//
// --color-accent is the right token here: it fails AA as small TEXT, but icons, borders and the
// focus ring are exactly what it is for (see .claude/rules/frontend-core.md).
function BenefitCheck() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function BenefitList({ benefits = PLUS_BENEFITS, style }) {
  return (
    <ul style={{ ...benefitListStyle, ...style }}>
      {benefits.map((benefit) => (
        <li key={benefit.id} style={benefitItemStyle}>
          <BenefitCheck />
          <span>{benefit.label}</span>
        </li>
      ))}
    </ul>
  );
}

const benefitListStyle = {
  listStyle: 'none',
  padding: 0,
  margin: '0 0 var(--space-5) 0',
  display: 'grid',
  gap: 'var(--space-3)',
};

const benefitItemStyle = {
  color: 'var(--color-text)',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-3)',
  lineHeight: 1.45,
};
