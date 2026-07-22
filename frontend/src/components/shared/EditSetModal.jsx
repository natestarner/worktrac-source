import { useState } from 'react';
import { queryClient, enqueueOutboxWrite, EDIT_SET_MUTATION_KEY } from '../../lib/queryClient';
import { queryKeys } from '../../api/queryKeys';
import WeightRepsStepper from '../log/WeightRepsStepper';
import Modal from './Modal';
import { cancelButtonStyle } from './ConfirmDialog';
import Button from './Button';

export default function EditSetModal({ set, personId, onClose, onSaved }) {
  const [weight, setWeight] = useState(set.weight);
  const [reps, setReps] = useState(set.reps);
  // Durable so an edit made offline queues and replays; the registered default reconciles sets/PRs/
  // History on sync. Only synced sets are editable (an unsynced set shows "will sync"), so set.id is
  // a real server id here.
  const step = set.unit === 'kg' ? 2.5 : 5;

  function handleSave() {
    const sessionId = set.sessionId ?? null;
    // Show the new values immediately (offline included, where the write settles only on reconnect).
    queryClient.setQueryData(queryKeys.sessionSets(sessionId, set.exerciseId), (old = []) =>
      old.map((s) => (s.id === set.id ? { ...s, weight, reps } : s)),
    );
    enqueueOutboxWrite(EDIT_SET_MUTATION_KEY, { setId: set.id, weight, reps, personId, sessionId, exerciseId: set.exerciseId });
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
