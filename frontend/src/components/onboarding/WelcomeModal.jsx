import Modal from '../shared/Modal';
import Button from '../shared/Button';
// The huddle-of-people mark, shared with the billing screen -- see HuddleMark for why it is drawn
// inline rather than loaded from the asset file. It opens this screen rather than a generic hero
// graphic because the cluster IS the product: a household, together.
import HuddleMark from '../shared/HuddleMark';

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
        <HuddleMark size={128} />
      </div>
      <p
        style={{
          margin: '0 0 var(--space-5)',
          color: 'var(--color-text)',
          fontSize: 'var(--text-base)',
          lineHeight: 'var(--leading-normal)',
        }}
      >
        A quick, nine-step walk through the real screens: picking an exercise, logging a set,
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
