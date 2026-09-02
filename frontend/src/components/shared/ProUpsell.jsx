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
//
// `action` is an optional control rendered in the same row as the link, for a prompt that needs to
// offer something besides "go to billing" -- today only HistoryWindowNotice's "About your full history"
// affordance. It sits out here rather than inside `children` so it lands in the flex row and can
// reach the 44px touch target; a control nested in the paragraph cannot without wrecking the line.
// It is deliberately NOT a second upgrade path: keep it to explanation, or this stops being one way
// to ask and becomes two.
export default function ProUpsell({ plan, children, action }) {
  if (plan !== 'FREE') return null;

  return (
    <div style={wrapStyle}>
      <p style={textStyle}>{children}</p>
      {action}
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
