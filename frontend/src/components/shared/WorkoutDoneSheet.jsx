import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { sessionRecapTiles } from '../../utils/sessionRecap';
import AddPersonModal from './AddPersonModal';
import Button from './Button';
import Modal from './Modal';
import OfflineDisabledWrap from './OfflineDisabledWrap';
import SectionLabel from './SectionLabel';

// What "End workout" leads to: the workout's numbers, and -- while the household is one person --
// the one question that matters most to a new account, "who else trains with you?". It replaced a
// 3.2s toast ("Workout ended — 3 exercises · 12 sets"), which is easy to miss with the phone back
// in a pocket and had nowhere to put a next step.
//
// ## Nothing here is computed from the cache
//
// `summary` is what EndWorkoutConfirmModal counted on the render it opened, handed through
// SessionBar. By the time this mounts the End tap has already nulled the live session, so a
// recount here would report an empty workout -- the same reason the toast was handed its text
// rather than recomputing it. The tiles format through utils/sessionRecap.js, beside the End
// dialog's sentence, so the two cannot disagree. Nothing reads connectivity: the sheet is the
// same in every mode (parity-session-recap.spec.ts). Only "Add a person" is gated, through the
// same OfflineDisabledWrap the person bar uses, because adding a person is a Tier-3 write.
//
// ## Closing is the one exit, and SessionBar owns what follows it
//
// The App Store rating ask and the service worker's forced update both used to fire at the End
// tap; with a sheet on screen either would land on top of it (the forced update by reloading the
// page out from under it). SessionBar now runs both from `onClose`. So every way out -- Done, the
// X, Escape, and finishing or cancelling the add-person dialog -- goes through `onClose` exactly
// once. Adding a person swaps this sheet for AddPersonModal rather than stacking a second dialog
// on it, and AddPersonModal's own close is this sheet's close.
//
// ## A sheet on a phone, a dialog elsewhere
//
// The same compact/regular split as DatePickerSheet: a bottom sheet on a phone, in thumb reach;
// a centred dialog on an iPad or a desktop, where a sheet would be a strip glued to the bottom of
// a large screen.
const SHEET_MAX_WIDTH = 420;
const DIALOG_WIDTH = 360;

export default function WorkoutDoneSheet({ summary, onClose }) {
  const compact = useMediaQuery('(max-width: 599px)');
  const { people } = useAuth();
  const { isMember } = useAccountAccess();
  const [addingPerson, setAddingPerson] = useState(false);
  const tiles = sessionRecapTiles(summary) ?? [];

  // Only while the household is one person, and only for whoever can add one: MANAGE_PEOPLE is
  // owner-only, and a member has no path to it (PersonPillBar hides its button for the same
  // reason). Once a second person exists the question has been answered.
  const askForPerson = !isMember && (people?.length ?? 0) === 1;

  if (addingPerson) return <AddPersonModal onClose={onClose} />;

  return (
    <Modal
      title="Workout done"
      onClose={onClose}
      align={compact ? 'bottom' : 'center'}
      width={compact ? SHEET_MAX_WIDTH : DIALOG_WIDTH}
    >
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              padding: 'var(--space-3) var(--space-2)',
              background: 'var(--color-subtle-bg)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text)' }}>
              {tile.value}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{tile.label}</div>
          </div>
        ))}
      </div>

      {askForPerson && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <SectionLabel style={{ marginBottom: 'var(--space-2)' }}>Who else trains with you?</SectionLabel>
          <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
            Add them to your household. Everyone’s numbers stay separate, and you switch with one tap.
          </p>
          <OfflineDisabledWrap message="Adding a person needs a connection.">
            <Button variant="primary" size="lg" fullWidth onClick={() => setAddingPerson(true)}>
              Add a person
            </Button>
          </OfflineDisabledWrap>
        </div>
      )}

      {/* At most one primary per screen: when the household ask is showing, it is the primary and
          Done steps back. */}
      <Button variant={askForPerson ? 'secondary' : 'primary'} size="lg" fullWidth onClick={onClose}>
        Done
      </Button>
    </Modal>
  );
}
