import { Link, useNavigate } from 'react-router-dom';
import Modal from './Modal';
import Button from './Button';
import { PRO_BENEFITS } from '../billing/planCopy';
import { windowLabel } from './historyWindowCopy';
import { formatDate } from '../../utils/datetime';

// The explainer behind HistoryWindowNotice's "Why is this hidden?" control.
//
// THIS IS A MODAL, AND ProUpsell's header says never to use one. The distinction is solicited vs
// unsolicited: what that rule forbids is an upgrade prompt that INTERRUPTS -- an interstitial
// someone mid-set has to dismiss to get back to logging. This one only ever opens from an explicit
// tap on a "why?" control, in answer to a question the person just asked. Nothing opens it
// automatically, and nothing may be changed to. See .claude/rules/billing.md.
//
// Its job is to be honest first and persuasive second, in that order. The two facts most apps would
// leave out -- that PR detection has been reading the whole history all along, and that export is
// free on both plans -- are here deliberately: someone deciding whether to pay is owed the reasons
// not to, and an upgrade taken on a complete picture is the only kind worth having.
export default function HistoryWindowModal({ historyWindow, onClose }) {
  const navigate = useNavigate();
  const hidden = historyWindow?.hiddenSessions ?? 0;
  const since = historyWindow?.earliestHiddenAt;

  return (
    <Modal width={360} onClose={onClose} title="Why some workouts are hidden">
      <p style={leadStyle}>
        {hidden === 1 ? '1 workout' : `${hidden} workouts`}
        {since ? `, going back to ${formatDate(since)},` : ''} {hidden === 1 ? 'sits' : 'sit'}{' '}
        outside {windowLabel(historyWindow?.windowStart)}. History, PRs and Trends show that window
        on Free.
      </p>

      {/* The reassurance comes before the pitch, on purpose. The marketing site promises this in
          writing twice, and someone who has just discovered data missing from their own screen
          needs the answer to "did I lose it?" before anything else. */}
      <p style={reassuranceStyle}>
        <strong>Nothing is deleted, ever.</strong> Every one of those workouts is still saved. They
        come straight back the moment you upgrade, and they stay put if you never do.
      </p>

      <div style={benefitsWrapStyle}>
        <div style={benefitsTitleStyle}>Pro adds</div>
        <ul style={listStyle}>
          {PRO_BENEFITS.map((benefit) => (
            <li key={benefit.id} style={listItemStyle}>
              {benefit.label}
            </li>
          ))}
        </ul>
      </div>

      <p style={footnoteStyle}>
        Two things that don&rsquo;t change on Free: your records are detected against your whole
        history, so a PR you were congratulated for was a real one — and exporting all of your data
        is free on both plans.
      </p>

      <div style={actionsStyle}>
        {/* "Unlock full history" shares no substring with "Go Pro" (the header badge, on screen
            behind this), "See Pro" (the notice that opened it, also still on screen) or "Close"
            (this modal's X). Playwright matches accessible names as a case-insensitive substring,
            so those four have to stay mutually non-containing. See .claude/rules/billing.md. */}
        <Button
          variant="primary"
          fullWidth
          onClick={() => {
            onClose();
            navigate('/app/billing');
          }}
        >
          Unlock full history
        </Button>
        <Link to="/app/help#plan" className="pressable" style={handbookLinkStyle} onClick={onClose}>
          How Free and Pro differ
        </Link>
      </div>
    </Modal>
  );
}

const leadStyle = {
  margin: 0,
  fontSize: 'var(--text-base)',
  color: 'var(--color-text)',
  lineHeight: 1.5,
};

const reassuranceStyle = {
  margin: 'var(--space-4) 0 0',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-muted)',
  lineHeight: 1.5,
};

const benefitsWrapStyle = {
  marginTop: 'var(--space-5)',
  background: 'var(--color-subtle-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
};

const benefitsTitleStyle = {
  fontSize: 'var(--text-2xs)',
  fontWeight: 'var(--weight-bold)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  marginBottom: 'var(--space-2)',
};

const listStyle = {
  margin: 0,
  paddingLeft: 'var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const listItemStyle = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text)',
  lineHeight: 1.45,
};

const footnoteStyle = {
  margin: 'var(--space-4) 0 0',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-muted)',
  lineHeight: 1.5,
};

const actionsStyle = {
  marginTop: 'var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-2)',
};

const handbookLinkStyle = {
  color: 'var(--color-accent-text)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  textDecoration: 'none',
  // 44px touch-target floor -- this app is used on an iPad mid-workout.
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
};
