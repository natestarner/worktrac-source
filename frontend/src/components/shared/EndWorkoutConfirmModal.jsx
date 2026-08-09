import { queryClient, enqueueOutboxWrite, END_WORKOUT_MUTATION_KEY } from '../../lib/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { markSessionEnded } from '../../lib/endedSessions';
import { useUI } from '../../context/UIContext';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';

export default function EndWorkoutConfirmModal({ personId, onClose, onEnded }) {
  const { skipRestTimer } = useUI();

  function handleEnd() {
    // Record the ended id SYNCHRONOUSLY before touching the query cache. The cache clear below only
    // reaches disk on the persister's next throttled tick, so a silent service-worker reload can
    // restore this finished session and -- because it carries a real id -- have it treated as live.
    // See endedSessions.js; useLiveSession consults this marker.
    const endedId = queryClient.getQueryData(queryKeys.liveSession(personId))?.id;
    markSessionEnded(personId, endedId);
    // Optimistically clear the live session so the green dot and "session in progress" banner clear
    // instantly -- offline included, where the durable end-workout write only settles on reconnect.
    queryClient.setQueryData(queryKeys.liveSession(personId), null);
    skipRestTimer(personId);
    enqueueOutboxWrite(END_WORKOUT_MUTATION_KEY, { personId });
    onEnded();
  }

  return (
    <Modal width={320} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>End this workout?</div>
      <div style={{ fontSize: 14, color: 'var(--color-muted)', marginBottom: 20 }}>
        You can keep going any time &mdash; logging another set later will simply start a new workout.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleEnd}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          End workout
        </Button>
      </div>
    </Modal>
  );
}
