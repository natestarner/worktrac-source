import Modal from '../shared/Modal';
import Button from '../shared/Button';

// The four-circle cluster from the Huddle mark (assets/huddle-lockup-*.svg) -- literally a huddle
// of people, which is the whole reason it was picked to open this screen rather than a generic
// hero graphic. Redrawn inline (not the SVG asset file) so the two colours that need to differ by
// theme -- the near-white circle, and the hairline that keeps it readable against a light
// surface -- can use this app's actual tokens instead of the asset's own hardcoded light/dark
// pair. The three brand-accent circles are the mark's fixed identity colours, not tokens (the
// same literals the asset files use) -- a logo keeps its own colours regardless of theme, same as
// the wordmark beside it never re-inks itself.
function WelcomeMark() {
  return (
    <svg width={128} height={114} viewBox="162 135 129 115" aria-hidden="true">
      <circle cx="200" cy="175" r="34" fill="#D4673E" />
      <circle cx="258" cy="168" r="29" fill="#F2A65A" />
      <circle cx="198" cy="221" r="25" fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth="1.5" />
      <circle cx="250" cy="219" r="19" fill="#B5542D" />
    </svg>
  );
}

// The very first thing a brand-new account sees, on its first login only (armed at email
// confirmation -- see AuthContext.confirmEmail and lib/onboardingPending.js). An existing account
// never sees this again; it replays the identical tour from a button on the Help tab instead,
// which is exactly why the body says so below -- "Not now" has to read as a postponement, not a
// one-way door.
//
// A plain Modal, not a custom overlay: this is a real decision point with two real options and no
// anchored control to point at yet, so it gets the full dialog treatment (focus trap, Escape,
// scroll lock) for free rather than reimplementing any of it.
export default function WelcomeModal({ onAccept, onDismiss }) {
  return (
    <Modal title="Welcome to Huddle" onClose={onDismiss} width={360}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-5)' }}>
        <WelcomeMark />
      </div>
      <p
        style={{
          margin: '0 0 var(--space-5)',
          color: 'var(--color-text)',
          fontSize: 'var(--text-base)',
          lineHeight: 'var(--leading-normal)',
        }}
      >
        A quick, nine-step walk through the real screens — picking an exercise, logging a set,
        adding the people you train with. About a minute, and you can start it again any time from{' '}
        <strong>Help</strong> in the account menu.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Button onClick={onAccept} variant="primary" size="lg" fullWidth>
          Show me around
        </Button>
        <Button onClick={onDismiss} variant="ghost" size="lg" fullWidth>
          Not now
        </Button>
      </div>
    </Modal>
  );
}
