import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { declineHouseholdAsk, isHouseholdAskDeclined } from '../../lib/householdAsk';
import { accountVocab } from '../../utils/accountVocab';
import { localeFormat } from '../../utils/datetime';
import { sessionRecapTiles } from '../../utils/sessionRecap';
import lockupOnDark from '../../assets/huddle-lockup-horizontal-ondark.svg';
import AddPersonModal from './AddPersonModal';
import Button from './Button';
import HuddleMark from './HuddleMark';
import Modal from './Modal';
import OfflineDisabledWrap from './OfflineDisabledWrap';

// What "End workout" leads to: the workout as a Huddle card, and -- while the household is one
// person -- the one question that matters most to a new account, "who else trains with you?". It
// replaced a 3.2s toast ("Workout ended — 3 exercises · 12 sets"), which is easy to miss with the
// phone back in a pocket and had nowhere to put a next step.
//
// ## The card
//
// Charcoal, the on-dark lockup, whose workout and when, then the numbers (.brand-card in
// index.css; the --brand-card-* tokens). The same object in light and dark mode, like the
// home-screen icon it matches -- so it is also the natural thing to share later. The mark in its
// corner is HuddleMark, never a third copy of the geometry (frontend-core.md), with its hairline
// pinned off: the ground is dark in both themes, and the hairline follows the ground.
//
// "Workout done" is the Modal's own title, beside the X, and the card says only whose workout and
// when. A title-less Modal still reserves its header row for the X, which left an empty band
// above the card; and the card saying "Workout done" under a title that says it too was twice.
//
// ## Nothing here is computed from the cache
//
// `summary` is what EndWorkoutConfirmModal counted on the render it opened, handed through
// SessionBar. By the time this mounts the End tap has already nulled the live session, so a
// recount here would report an empty workout. The stats format through utils/sessionRecap.js,
// beside the End dialog's sentence, so the two cannot disagree. Nothing reads connectivity: the
// sheet is the same in every mode (parity-session-recap.spec.ts). Only "Add a person" is gated,
// through the same OfflineDisabledWrap the person bar uses, because adding a person is a Tier-3
// write.
//
// ## Closing is the one exit, and SessionBar owns what follows it
//
// The App Store rating ask and the service worker's forced update both used to fire at the End
// tap; with a sheet on screen either would land on top of it (the forced update by reloading the
// page out from under it). SessionBar now runs both from `onClose`. So every way out -- Done, the
// X, Escape, "Just me", and finishing or cancelling the add-person dialog -- goes through
// `onClose` exactly once. Adding a person swaps this sheet for AddPersonModal rather than stacking
// a second dialog on it, and AddPersonModal's own close is this sheet's close.
//
// ## A sheet on a phone, a dialog elsewhere
//
// The same compact/regular split as DatePickerSheet: a bottom sheet on a phone, in thumb reach;
// a centred dialog on an iPad or a desktop, where a sheet would be a strip glued to the bottom of
// a large screen.
const SHEET_MAX_WIDTH = 420;
const DIALOG_WIDTH = 380;
const CARD_DATE = { weekday: 'short', month: 'short', day: 'numeric' };

export default function WorkoutDoneSheet({ personId, summary, onClose }) {
  const compact = useMediaQuery('(max-width: 599px)');
  const { people, account } = useAuth();
  const { isMember } = useAccountAccess();
  const [addingPerson, setAddingPerson] = useState(false);
  const tiles = sessionRecapTiles(summary) ?? [];
  const vocab = accountVocab(account?.vocab);
  const personName = people?.find((p) => p.id === personId)?.name;
  // The day the workout ended, which is the day the sheet opens.
  const [today] = useState(() => localeFormat(new Date(), CARD_DATE));

  // Only while the household is one person, only for whoever can add one (MANAGE_PEOPLE is
  // owner-only, and PersonPillBar hides its button from a member for the same reason), and only
  // until it has been answered. A second person answers it; so does "Just me", which is
  // remembered -- without it, someone who trains alone was asked after every workout, forever.
  const askForPerson = !isMember && (people?.length ?? 0) === 1 && !isHouseholdAskDeclined(account?.id);

  function justMe() {
    declineHouseholdAsk(account?.id);
    onClose();
  }

  if (addingPerson) return <AddPersonModal onClose={onClose} />;

  return (
    <Modal
      title="Workout done"
      onClose={onClose}
      align={compact ? 'bottom' : 'center'}
      width={compact ? SHEET_MAX_WIDTH : DIALOG_WIDTH}
    >
      <div className="brand-card" style={{ marginBottom: 'var(--space-5)' }}>
        <HuddleMark size={112} hairline="transparent" className="brand-card__mark" />
        <div className="brand-card__top">
          <img src={lockupOnDark} alt="Huddle" className="brand-card__lockup" />
          <div className="brand-card__who">
            {personName && <div className="brand-card__name">{personName}</div>}
            {today}
          </div>
        </div>
        <div className="brand-card__stats">
          {tiles.map((tile) => (
            <div key={tile.label} className="brand-card__stat">
              <span className="brand-card__value">{tile.value}</span>
              <span className="brand-card__label">{tile.label}</span>
            </div>
          ))}
        </div>
      </div>

      {askForPerson ? (
        <div>
          <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)' }}>
            Who else trains with you?
          </p>
          <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
            Add them to your {vocab.account}. Everyone’s numbers stay separate.
          </p>
          {/* The question's two answers, side by side; either one closes the sheet. "Just me" is
              not offline-gated: it writes only to this device. */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <OfflineDisabledWrap message="Adding a person needs a connection.">
              <Button variant="primary" size="lg" onClick={() => setAddingPerson(true)} style={{ flex: 1 }}>
                Add a person
              </Button>
            </OfflineDisabledWrap>
            <Button variant="secondary" size="lg" onClick={justMe} style={{ flex: 1 }}>
              Just me
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" size="lg" fullWidth onClick={onClose}>
          Done
        </Button>
      )}
    </Modal>
  );
}
