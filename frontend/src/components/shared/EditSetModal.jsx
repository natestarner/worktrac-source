import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dispatchDurableWrite, EDIT_SET_MUTATION_KEY } from '../../lib/queryClient';
import { patchPendingLogSetDisplay } from '../../lib/offlineSetEdits';
import { queryKeys } from '../../api/queryKeys';
import WeightRepsStepper from '../log/WeightRepsStepper';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';

// exerciseId/sessionId are always taken from the caller's own context (ExerciseDetail already
// knows both) rather than read off `set` -- a synced set carries them too, but an offline-logged,
// not-yet-synced optimistic row never does, so this is the one code path that works for both.
export default function EditSetModal({ set, personId, exerciseId, exerciseName, sessionId, onClose, onSaved }) {
  // Via context (not the app singleton) so this finds/patches whichever client actually dispatched
  // the pending logSet mutation being edited -- the same client ExerciseDetail's useMutation used.
  const queryClient = useQueryClient();
  const [weight, setWeight] = useState(set.weight);
  const [reps, setReps] = useState(set.reps);
  const step = set.unit === 'kg' ? 2.5 : 5;

  function handleSave() {
    // Show the new values immediately (offline included, where the write settles only on
    // reconnect). Skipped when there's no session yet -- the very first set(s) of an offline
    // workout live only as mutation state, not in this cache (see pendingBeforeSession).
    if (sessionId) {
      queryClient.setQueryData(queryKeys.sessionSets(sessionId, exerciseId), (old = []) =>
        old.map((s) => (s.id === set.id ? { ...s, weight, reps } : s)),
      );
    }
    if (set.optimistic) {
      // Not yet synced -- the queued CREATE is deliberately left untouched (see offlineSetEdits.js
      // for why: no public API to edit or cancel an in-flight mutation, and re-dispatching it under
      // the same idempotency key risks the backend silently discarding the edit). Only the
      // pre-session display needs a direct patch; once a session exists the setQueryData above
      // already covers it.
      patchPendingLogSetDisplay(queryClient, set.id, { weight, reps });
    }
    // Always a real, separate EDIT_SET write -- set.id is the tempId for an optimistic row
    // (resolved once its create syncs, see queryClient.js's requireResolvedSetId/setSetIdMapping)
    // or a real id for an already-synced one. Editing a pending set now behaves identically to
    // editing a synced set in every connectivity mode. Dispatched against the same context
    // `queryClient` used above (not the app-singleton-only enqueueOutboxWrite) so it lands in the
    // exact mutation cache holding the matching pending create.
    dispatchDurableWrite(queryClient, EDIT_SET_MUTATION_KEY, { setId: set.id, weight, reps, personId, sessionId, exerciseId, exerciseName });
    onSaved();
  }

  return (
    <Modal width={320} onClose={onClose} title="Edit set">
      <WeightRepsStepper
        label={`Weight (${set.unit || 'lb'})`}
        value={weight}
        size="sm"
        onDec={() => setWeight(Math.max(0, Math.round((weight - step) * 2) / 2))}
        onInc={() => setWeight(Math.round((weight + step) * 2) / 2)}
        onChange={setWeight}
      />
      <WeightRepsStepper
        label="Reps"
        value={reps}
        size="sm"
        onDec={() => setReps(Math.max(0, reps - 1))}
        onInc={() => setReps(reps + 1)}
        onChange={setReps}
      />
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleSave}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
