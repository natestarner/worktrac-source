import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addExercise, updateExercise, favoriteExercise } from '../../api/exercises';
import { queryKeys } from '../../api/queryKeys';
import { CREATE_EXERCISE_MUTATION_KEY } from '../../lib/queryClient';
import { newTempExerciseId } from '../../lib/exerciseIdMap';
import { newId } from '../../utils/id';
import { useDurableMutation } from '../../hooks/useDurableMutation';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import Modal from '../shared/Modal';
import { cancelButtonStyle } from '../shared/ConfirmDialog';
import Button from '../shared/Button';

// Optimistically drop a just-created (offline) exercise into the shared catalog and this person's
// picker list, so it's selectable and loggable immediately -- before its create has synced. Keyed by
// the temp id; the real exercise takes its place when the create mutation's onSettled invalidates
// these queries after sync.
function insertOptimisticExercise(queryClient, personId, tempExercise) {
  queryClient.setQueryData(queryKeys.exercises(), (old = []) => [...old, tempExercise]);
  queryClient.setQueryData(queryKeys.personExercises(personId), (old = []) => [...old, tempExercise]);
}

// Add-your-own / edit-your-own exercise. Categories are per-person now, so there's no category
// selector here -- a new exercise is created uncategorized and auto-favorited for the active
// person (file it into a category later from the picker). Setup fields are also per-person and
// added later from the exercise's Customize screen. Editing is only reachable for the account's
// own exercises; preloaded ones are favorite-as-is.
export default function AddEditExerciseModal({ exercise, personId, initialName = '', requireSyncedExercise = false, onClose, onSaved }) {
  const isEditing = !!exercise;
  const [name, setName] = useState(exercise?.name || initialName || '');
  const [nameError, setNameError] = useState(false);
  const { run, pending: saving } = useGatedMutation();
  const queryClient = useQueryClient();
  // Durable create (create + auto-favorite, both idempotent) so an offline create replays safely and
  // records its temp->real id mapping on sync. See queryClient.js.
  const createExerciseMutation = useDurableMutation({ mutationKey: CREATE_EXERCISE_MUTATION_KEY });

  // Renaming an existing exercise stays online-only (a Customize-screen action, Tier 3).
  // Gated up front so a dead-but-reachable backend (lie-fi) toasts immediately instead of hanging
  // for the request timeout, and caught, since the request can still fail after starting -- Save
  // must never leave the button stuck with the modal open. Both halves now come from
  // useGatedMutation instead of being open-coded here.
  const saveRename = run(
    async (trimmed) => {
      const updated = await updateExercise(exercise.id, { name: trimmed });
      onSaved(updated);
    },
    { errorMessage: "Couldn't save -- check your connection and try again." },
  );

  // A caller that needs a real, already-synced exercise id (the Routines form sends the created
  // exercise's id straight into its own non-durable, non-idempotent createRoutine/updateRoutine
  // call, which can't be replayed against a temp id) opts into the online-only path via
  // requireSyncedExercise.
  const saveSynced = run(
    async (trimmed) => {
      const created = await addExercise({ name: trimmed });
      if (personId) await favoriteExercise(personId, created.id);
      onSaved(created);
    },
    { errorMessage: "Couldn't create -- check your connection and try again." },
  );

  // Three paths, and all three are deliberate -- see the register in .claude/rules/resilience.md.
  // What is NOT deliberate is having three DIFFERENT implementations of "gate on online, show a
  // toast, track a busy flag, catch the failure": the two gated paths now share one mechanism with
  // every other Tier-3 write in the app, leaving only the branch itself here.
  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }

    if (isEditing) return saveRename(trimmed);
    if (requireSyncedExercise) return saveSynced(trimmed);

    // Every other caller (the Log tab): always take the optimistic outbox path, even while
    // genuinely online -- Save closes instantly and can never hang against a dead-but-reachable
    // backend. Mint a temp exercise so it can be selected and logged against right now, and queue
    // the durable create; the queued create + any set-logs against the temp id replay in order on
    // reconnect (or near-instantly if actually online) and resolve to the real id -- see LogTab's
    // mutation-cache subscription, which remaps the current selection from temp to real on sync.
    const tempId = newTempExerciseId();
    const tempExercise = {
      id: tempId,
      name: trimmed,
      trackingType: 'strength',
      isGlobal: false,
      isFavorite: true,
      tags: [],
      optimistic: true,
    };
    insertOptimisticExercise(queryClient, personId, tempExercise);
    createExerciseMutation.mutate({ tempId, name: trimmed, personId, idempotencyKey: newId() });
    onSaved(tempExercise);
  }

  return (
    <Modal width={340} onClose={onClose} title={isEditing ? 'Edit exercise' : 'Add exercise'}>
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError(false);
        }}
        placeholder="Exercise name"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: `1px solid ${nameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 10,
          fontSize: 16,
          marginBottom: nameError ? 6 : 16,
        }}
      />
      {nameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 12 }}>Enter an exercise name.</div>
      )}

      {isEditing && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 18 }}>
          Renaming keeps all logged sets, history, and PRs for this exercise intact.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onClose} style={cancelButtonStyle}>
          Cancel
        </button>
        <Button
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 1, padding: 14, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          {isEditing ? 'Save' : 'Add'}
        </Button>
      </div>
    </Modal>
  );
}
