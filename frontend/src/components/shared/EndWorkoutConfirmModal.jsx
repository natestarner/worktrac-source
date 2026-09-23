import { queryClient, enqueueOutboxWrite, isUnsyncedWrite, END_WORKOUT_MUTATION_KEY, LOG_SET_MUTATION_KEY } from '../../lib/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { markCreatesEnded, markSessionEnded } from '../../lib/endedSessions';
import { tryHaptic } from '../../lib/haptics';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useSessionRecap } from '../../hooks/useSessionRecap';
import { formatSessionRecap, sessionElapsedMs } from '../../utils/sessionRecap';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';

// The tempIds of this person's live-set creates that have not landed yet -- the sets of the workout
// being ended. Session-edit creates are excluded: they log into a PAST session, not the live one.
function pendingLiveSetCreates(personId) {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => m.options.mutationKey?.[0] === LOG_SET_MUTATION_KEY[0])
    .filter((m) => m.state.variables?.personId === personId && m.state.variables?.mode !== 'session')
    .filter((m) => isUnsyncedWrite({ status: m.state.status, errorStatus: m.state.error?.status }))
    .map((m) => m.state.variables?.tempId)
    .filter(Boolean);
}

export default function EndWorkoutConfirmModal({ personId, onClose, onEnded }) {
  const { clearRestTimer } = useUI();
  const { setRestTimer } = useAppState();
  const { exerciseCount, setCount, startedAt } = useSessionRecap(personId);

  // Computed once, on the render the modal opens, and handed to onEnded so the toast that follows
  // formats from the SAME derivation rather than recomputing against a cache the end-workout write
  // has already begun clearing. `null` whenever there is nothing worth reporting.
  const recap = formatSessionRecap({ exerciseCount, setCount, elapsedMs: sessionElapsedMs(startedAt) });

  function handleEnd() {
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
    if (endedId == null) markCreatesEnded(personId, pendingLiveSetCreates(personId));
    // Optimistically clear the live session so the green dot and "session in progress" banner clear
    // instantly -- offline included, where the durable end-workout write only settles on reconnect.
    queryClient.setQueryData(queryKeys.liveSession(personId), null);
    // Both copies, in the same synchronous step. Clearing only the in-memory one leaves the
    // persisted start behind for AppShell to resume on the next mount -- a rest timer for a workout
    // that is over, which is the same class of resurrection endedSessions.js exists to prevent for
    // the live session itself.
    clearRestTimer(personId);
    setRestTimer({});
    enqueueOutboxWrite(END_WORKOUT_MUTATION_KEY, { personId });
    // A softer tick than the PR's double tap: finishing is an acknowledgement, not a fanfare.
    // Fired here rather than in onEnded so it lands on the tap that ends the workout, and so it
    // stays tied to the act itself rather than to whatever the caller does afterwards.
    tryHaptic('complete');
    onEnded(recap);
  }

  return (
    <Modal width={320} onClose={onClose} title="End this workout?">
      {/* What they actually did, above the reassurance rather than instead of it. This is the
          moment the numbers are most worth saying, and the modal is where they are certain to be
          read -- a 3.2s toast after the fact is easy to miss with a phone back in a pocket. */}
      {recap && (
        <div
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--color-text)',
            marginBottom: 'var(--space-2)',
          }}
        >
          {recap}
        </div>
      )}
      <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 20 }}>
        You can keep going any time. Logging another set later will simply start a new workout.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleEnd}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          End workout
        </Button>
      </div>
    </Modal>
  );
}
