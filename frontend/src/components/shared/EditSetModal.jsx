import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { enqueueOutboxWrite, EDIT_SET_MUTATION_KEY } from '../../lib/queryClient';
import { replacePendingLogSet } from '../../lib/offlineSetEdits';
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
      // Not yet synced -- "editing" it means correcting the pending create, not queuing a write
      // against a set id that doesn't exist yet. See offlineSetEdits.js.
      replacePendingLogSet(queryClient, set.id, { weight, reps });
    } else {
      // Only reached for an already-synced set (an unsynced set shows Edit/Delete too now, but
      // routes through the branch above), so set.id is a real id here.
      enqueueOutboxWrite(EDIT_SET_MUTATION_KEY, { setId: set.id, weight, reps, personId, sessionId, exerciseId, exerciseName });
    }
    onSaved();
  }

  return (
    <Modal width={320} onScrim={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 18 }}>Edit set</div>
      <WeightRepsStepper
        label={`Weight (${set.unit || 'lb'})`}
        value={weight}
        size="sm"
        onDec={() => setWeight(Math.max(0, Math.round((weight - step) * 2) / 2))}
        onInc={() => setWeight(Math.round((weight + step) * 2) / 2)}
      />
      <WeightRepsStepper label="Reps" value={reps} size="sm" onDec={() => setReps(Math.max(0, reps - 1))} onInc={() => setReps(reps + 1)} />
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
