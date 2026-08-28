import { Link } from 'react-router-dom';

// The one way this app asks someone to upgrade, so every prompt reads the same and none of them
// can drift into being pushier than the others.
//
// It is a quiet, inline note next to the thing the person just reached for -- never a modal, never
// an interstitial, never something that interrupts a workout. Someone mid-set who taps the wrong
// tab should not have to dismiss a sales pitch to get back to logging.
//
// It renders NOTHING while the plan is unknown, for the same reason PlanBadge does: an auth
// snapshot written before billing shipped carries no plan, and showing an upgrade prompt to a
// household that already pays is the worst outcome available here. Absence is the safe default.
export default function ProUpsell({ plan, children }) {
  if (plan !== 'FREE') return null;

  return (
    <div style={wrapStyle}>
      <p style={textStyle}>{children}</p>
      {/* "See Pro" -- deliberately not "Upgrade to Pro" (the billing screen's primary button) or
          "Go Pro" (the header badge). Playwright matches accessible names as a case-insensitive
          substring, so three controls that can share a screen need three mutually non-containing
          names. See .claude/rules/frontend-core.md. */}
      <Link to="/app/billing" className="pressable" style={linkStyle}>
        See Pro
      </Link>
    </div>
  );
}

const wrapStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
  background: 'var(--color-subtle-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3) var(--space-4)',
};

const textStyle = {
  margin: 0,
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  flex: 1,
  minWidth: 0,
};

const linkStyle = {
  color: 'var(--color-accent-text)',
  fontWeight: 700,
  fontSize: 'var(--text-sm)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  // 44px is the touch-target floor this app holds itself to; it is used on an iPad mid-workout.
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
};
