import { useMemo, useState } from 'react';
import { queryClient, enqueueOutboxWrite, pendingLiveSetCreates, END_WORKOUT_MUTATION_KEY } from '../../lib/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { markCreatesEnded, markSessionEnded } from '../../lib/endedSessions';
import { tryHaptic } from '../../lib/haptics';
import { noteWorkoutEnded } from '../../lib/reviewPrompt';
import { declineHouseholdAsk, isHouseholdAskDeclined } from '../../lib/householdAsk';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSessionRecap } from '../../hooks/useSessionRecap';
import { LIVE_WORKOUT_ID, VIEWER_ZONE, useStatsFromHistory } from '../../hooks/useStatsFromHistory';
import { accountVocab } from '../../utils/accountVocab';
import { localeFormat } from '../../utils/datetime';
import { sessionElapsedMs, sessionRecapTiles } from '../../utils/sessionRecap';
import { workoutHeadline } from '../../utils/workoutHeadline';
import lockupOnDark from '../../assets/huddle-lockup-horizontal-ondark.svg';
import AddPersonModal from './AddPersonModal';
import Button from './Button';
import HuddleMark from './HuddleMark';
import Modal from './Modal';
import OfflineDisabledWrap from './OfflineDisabledWrap';

// What "End workout" on the session bar opens: ONE sheet that asks the question and shows the
// workout as a Huddle card while it asks. It replaced two dialogs in a row -- an "End this
// workout?" confirm that already named the numbers, then a "Workout done" sheet that named them
// again -- which read as the same popup twice.
//
// ## Two states, one dialog
//
//   asking  "End this workout?" -- the card, the reassurance that logging again simply starts a new
//           workout, Cancel and End workout. Every exit but End (Cancel, the X, Escape) is
//           `onCancel`, and nothing has happened.
//   done    "Workout done" -- the SAME card, frozen at the End tap, and the one question that
//           matters most to a new account: "who else trains with you?". Shown only when that
//           question is due (a one-person household, an owner, not yet answered "Just me"). With
//           nothing to ask, End closes the sheet at once: the card has already been read.
//
// A workout with nothing in it (a mis-tap, every set deleted) gets no card -- "0 exercises · 0
// sets" would be worse than nothing -- and SessionBar says the plain sentence after the End.
//
// ## The card is live while asking, and frozen at the End tap
//
// Asking, the numbers and the headline are read on every render, from the workout still live in
// useSessionRecap and in useStatsFromHistory's fold. At the End tap they are captured, BEFORE the
// tap clears the live session: after it, a recount reports an empty workout, and the headline
// misses the workout in every degraded mode, because its queued sets leave the live fold and
// History does not have them yet (frontend-core.md; parity-session-recap's "names a new best").
// The done state renders only the captured copy.
//
// ## Closing after the End is the one exit, and SessionBar owns what follows it
//
// The App Store rating ask and the service worker's forced update wait for the sheet to close --
// at the tap, Apple's sheet would cover ours and the forced update would reload the page out from
// under it. So every way out after the End (End itself when nothing is asked, the X, Escape,
// "Just me", and finishing or cancelling the add-person dialog) is `onClose({ reviewDue })`,
// exactly once. The rating COUNT stays at the tap (noteWorkoutEnded, synchronous), so a reload with
// the sheet open cannot lose it.
//
// ## Nothing reads connectivity
//
// The sheet is the same in every mode (parity-session-recap.spec.ts). Only "Add a person" is gated,
// through the same OfflineDisabledWrap the person bar uses, because adding a person is a Tier-3
// write.
//
// ## A sheet on a phone, a dialog elsewhere
//
// The same compact/regular split as DatePickerSheet: a bottom sheet on a phone, in thumb reach; a
// centred dialog on an iPad or a desktop, where a sheet would be a strip glued to the bottom of a
// large screen.
const SHEET_MAX_WIDTH = 420;
const DIALOG_WIDTH = 380;
const CARD_DATE = { weekday: 'short', month: 'short', day: 'numeric' };

// The sentence, with its `emphasis` (a substring of it, or null) set in the highlight colour.
function Headline({ text, emphasis }) {
  const at = emphasis ? text.indexOf(emphasis) : -1;
  return (
    <p className="brand-card__headline">
      {at < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, at)}
          <em>{emphasis}</em>
          {text.slice(at + emphasis.length)}
        </>
      )}
    </p>
  );
}

// Charcoal, the on-dark lockup, whose workout and when, then the numbers (.brand-card in
// index.css; the --brand-card-* tokens). The same object in light and dark mode, like the
// home-screen icon it matches. The mark in its corner is HuddleMark, never a third copy of the
// geometry (frontend-core.md), with its hairline pinned off: the ground is dark in both themes.
function WorkoutCard({ personName, date, tiles, headline }) {
  return (
    <div className="brand-card" style={{ marginBottom: 'var(--space-5)' }}>
      <HuddleMark size={112} hairline="transparent" className="brand-card__mark" />
      <div className="brand-card__top">
        <img src={lockupOnDark} alt="Huddle" className="brand-card__lockup" />
        <div className="brand-card__who">
          {personName && <div className="brand-card__name">{personName}</div>}
          {date}
        </div>
      </div>
      {/* The one true thing worth saying about this workout (utils/workoutHeadline.js), with the
          words that carry the news in the mark's amber. Absent whenever nothing can honestly be
          said -- History not on this device, say -- and then the card is the numbers alone. */}
      {headline && <Headline {...headline} />}
      <div className="brand-card__stats">
        {tiles.map((tile) => (
          <div key={tile.label} className="brand-card__stat">
            <span className="brand-card__value">{tile.value}</span>
            <span className="brand-card__label">{tile.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EndWorkoutSheet({ personId, sessionId, onCancel, onEnded, onClose }) {
  const { clearRestTimer } = useUI();
  const { setRestTimer } = useAppState();
  const { people, account } = useAuth();
  const { isMember } = useAccountAccess();
  const compact = useMediaQuery('(max-width: 599px)');
  const { exerciseCount, setCount, startedAt } = useSessionRecap(personId);
  // The PRs board's and Trends' own fold, with this workout still live in it.
  const stats = useStatsFromHistory(personId);
  // `{ summary, tiles, headline, reviewDue }` captured at the End tap, or null while asking.
  const [done, setDone] = useState(null);
  const [addingPerson, setAddingPerson] = useState(false);
  // The moment the sheet opened: the card's date, and the "now" its headline is judged against.
  const [openedAt] = useState(() => Date.now());
  const today = localeFormat(new Date(openedAt), CARD_DATE);
  const vocab = accountVocab(account?.vocab);
  const personName = people?.find((p) => p.id === personId)?.name;

  const summary = { exerciseCount, setCount, elapsedMs: sessionElapsedMs(startedAt) };
  // Null whenever there is nothing worth reporting: then there is no card at all.
  const tiles = sessionRecapTiles(summary);
  // The workout's trend points carry its id, or LIVE_WORKOUT_ID while it has none -- the same id
  // the fold gave it.
  const workoutId = sessionId ?? LIVE_WORKOUT_ID;
  const hasSets = tiles != null;
  const headline = useMemo(
    () =>
      hasSets
        ? workoutHeadline(stats.digests, {
            workoutId,
            ready: stats.status === 'ready',
            zone: VIEWER_ZONE,
            now: openedAt,
            windowStart: stats.historyWindow?.windowStart ?? null,
            hiddenSessions: stats.historyWindow?.hiddenSessions ?? 0,
          })
        : null,
    [hasSets, stats.digests, stats.status, stats.historyWindow, workoutId, openedAt],
  );

  // Only while the household is one person, only for whoever can add one (MANAGE_PEOPLE is
  // owner-only, and PersonPillBar hides its button from a member for the same reason), and only
  // until it has been answered. A second person answers it; so does "Just me", which is
  // remembered -- without it, someone who trains alone was asked after every workout, forever.
  const askForPerson = !isMember && (people?.length ?? 0) === 1 && !isHouseholdAskDeclined(account?.id);

  function handleEnd() {
    // Captured first, while the workout is still live in every cache it is read from.
    const captured = { tiles, headline };
    // Record the ended id SYNCHRONOUSLY before touching the query cache. The cache clear below only
    // reaches disk on the persister's next throttled tick, so a silent service-worker reload can
    // restore this finished session and -- because it carries a real id -- have it treated as live.
    // See endedSessions.js; useLiveSession consults this marker.
    const endedId = queryClient.getQueryData(queryKeys.liveSession(personId))?.id;
    markSessionEnded(personId, endedId);
    // No id yet -- the workout's sets have not synced, so its session does not exist on this device
    // under any id. Record the sets instead, so the session they create is marked ended the moment
    // it lands rather than written back as live (see endedSessions.js#markCreatesEnded). A known id
    // is already covered above, so this runs only for the placeholder.
    if (endedId == null) markCreatesEnded(personId, pendingLiveSetCreates(queryClient, personId));
    // Optimistically clear the live session so the green dot and the session bar clear instantly --
    // offline included, where the durable end-workout write only settles on reconnect.
    queryClient.setQueryData(queryKeys.liveSession(personId), null);
    // Both copies, in the same synchronous step. Clearing only the in-memory one leaves the
    // persisted start behind for AppShell to resume on the next mount -- a rest timer for a workout
    // that is over, which is the same class of resurrection endedSessions.js exists to prevent for
    // the live session itself.
    clearRestTimer(personId);
    setRestTimer({});
    enqueueOutboxWrite(END_WORKOUT_MUTATION_KEY, { personId });
    // A softer tick than the PR's double tap: finishing is an acknowledgement, not a fanfare.
    tryHaptic('complete');
    // Counted here, at the tap, so a reload with the sheet open cannot lose it; the App Store
    // rating ask itself waits until the sheet closes (SessionBar). On the schedule in
    // lib/reviewPrompt.js (3rd workout, then every 5th); a no-op on the web.
    const reviewDue = noteWorkoutEnded({ setCount });
    onEnded({ hadSets: !!captured.tiles });
    if (captured.tiles && askForPerson) {
      setDone({ ...captured, reviewDue });
    } else {
      onClose({ reviewDue });
    }
  }

  const close = () => onClose({ reviewDue: done?.reviewDue ?? false });

  function justMe() {
    declineHouseholdAsk(account?.id);
    close();
  }

  if (addingPerson) return <AddPersonModal onClose={close} />;

  const card = done ?? (tiles ? { tiles, headline } : null);

  return (
    <Modal
      title={done ? 'Workout done' : 'End this workout?'}
      onClose={done ? close : onCancel}
      align={compact ? 'bottom' : 'center'}
      width={compact ? SHEET_MAX_WIDTH : DIALOG_WIDTH}
    >
      {card && <WorkoutCard personName={personName} date={today} tiles={card.tiles} headline={card.headline} />}

      {done ? (
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
        <>
          <p style={{ margin: '0 0 var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
            You can keep going any time. Logging another set later will simply start a new workout.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="secondary" size="lg" onClick={onCancel} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button variant="primary" size="lg" onClick={handleEnd} style={{ flex: 1 }}>
              End workout
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
