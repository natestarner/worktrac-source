import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addExercise, updateExercise, favoriteExercise } from '../../api/exercises';
import { queryKeys } from '../../api/queryKeys';
import { CREATE_EXERCISE_MUTATION_KEY, FAVORITE_MUTATION_KEY } from '../../lib/queryClient';
import { isTempExerciseId, newTempExerciseId, resolveExerciseId } from '../../lib/exerciseIdMap';
import { newId } from '../../utils/id';
import { MAX_EXERCISE_NAME_LENGTH, MEASURE_OPTIONS, measureLabel, resolveExerciseCreate } from '../../utils/exerciseDuplicates';
import { FIELD_LIMITS } from '../../utils/fieldLimits';
import { useDurableMutation } from '../../hooks/useDurableMutation';
import { useExercises } from '../../hooks/useExercises';
import { usePersonExercises } from '../../hooks/usePersonExercises';
import { useGatedMutation } from '../../hooks/useGatedMutation';
import { useUI } from '../../context/UIContext';
import Modal from '../shared/Modal';
import SegmentedToggle from '../shared/SegmentedToggle';
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
  // What a set of this exercise measures. Create-only: the backend has no setter for it, because
  // flipping it would silently reinterpret every set already logged against the exercise.
  const [trackingType, setTrackingType] = useState('strength');
  const { run, pending: saving } = useGatedMutation();
  const queryClient = useQueryClient();
  // Durable create (create + auto-favorite, both idempotent) so an offline create replays safely and
  // records its temp->real id mapping on sync. See queryClient.js.
  const createExerciseMutation = useDurableMutation({ mutationKey: CREATE_EXERCISE_MUTATION_KEY });
  const favoriteMutation = useDurableMutation({ mutationKey: FAVORITE_MUTATION_KEY });
  // Both call sites (LogTab, RoutineFormModal) already mount these, so this shares their cache
  // entries rather than fetching again -- and neither is ever awaited here, so a stale or failing
  // background refetch can't block or hang the modal in any connectivity mode.
  const { exercises: catalog } = useExercises();
  const { showToast } = useUI();
  const { exercises: personExercises } = usePersonExercises(personId);

  // Own exercises only, mirroring the server's countByAccount_IdAndDeletedFalse: the preloaded
  // global catalog is shared and costs the household nothing against its ceiling.
  const ownExerciseCount = (catalog || []).filter((e) => !e.isGlobal).length;

  // Derived during render, not in an effect, so the note, the button label and handleSave below all
  // read the same answer. Skipped entirely while editing -- rename is a different question, and
  // deliberately out of scope here (see saveRename).
  const resolution = isEditing
    ? null
    : resolveExerciseCreate({ catalog, name, trackingType });
  const openTarget = resolution?.kind === 'open' ? resolution.exercise : null;
  // Bounded so a very long name cannot turn the primary button into a paragraph (a name allows 200
  // characters; this modal is 340px wide). The VISIBLE text is what gets truncated and the
  // accessible name simply matches it -- an aria-label carrying the full name would visibly differ
  // from the label (WCAG 2.5.3), and e2e selects this button by its accessible name.
  const openLabel =
    openTarget && (openTarget.name.length > 32 ? `${openTarget.name.slice(0, 32)}…` : openTarget.name);
  const duplicateNote = openTarget
    ? 'You already have this exercise.'
    : resolution?.clashWith
      ? `You have a ${resolution.clashWith.name} measured in ${measureLabel(resolution.clashWith.trackingType)}. ` +
        `This one saves as ${resolution.name}.`
      : null;

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
    { errorMessage: "Couldn't save — check your connection and try again." },
  );

  // A caller that needs a real, already-synced exercise id (the Routines form sends the created
  // exercise's id straight into its own non-durable, non-idempotent createRoutine/updateRoutine
  // call, which can't be replayed against a temp id) opts into the online-only path via
  // requireSyncedExercise.
  const saveSynced = run(
    async (trimmed) => {
      const created = await addExercise({ name: trimmed, trackingType });
      if (personId) await favoriteExercise(personId, created.id);
      onSaved(created);
    },
    { errorMessage: "Couldn't create — check your connection and try again." },
  );

  // Open an exercise that already exists rather than making a second one. No create is dispatched,
  // in any mode -- there is nothing to write.
  //
  // The favorite mirrors what the create path's auto-favorite does for a brand-new exercise: it
  // puts the exercise in this person's picker, which is what "add this exercise" means to them.
  // Two guards on it, and both matter:
  //   - already favorited -> nothing to do.
  //   - an optimistic TEMP match -> skip. That exercise's own queued create already auto-favorites,
  //     so this would be a redundant DEPENDENT write on an unmapped temp id, and
  //     requireResolvedExerciseId throws a STATUS-LESS (therefore infinitely retryable) error for
  //     those. The outbox scope is strictly serial, so if that create ever died on a definitive
  //     4xx this favorite would head-of-line-block the whole outbox forever.
  function openExisting(exercise) {
    const alreadyFavorite = personExercises.some((e) => e.id === exercise.id && e.isFavorite);
    if (personId && !alreadyFavorite && !isTempExerciseId(exercise.id)) {
      // Put it in the picker NOW, the same way the create path's optimistic row does, and for the
      // same reason: FAVORITE has no onMutate, only an invalidation, and an invalidation is a no-op
      // while paused. Without this, "I added it and it isn't in my list" would be true offline and
      // false online -- a connectivity-shaped difference in a flow that must not have one.
      //
      // Add-or-patch, not patch: a preloaded exercise the person has never favorited is not in their
      // list at all, so ExerciseDetail's handleToggleFavorite (which only maps over rows already
      // there) would not be enough. Returning undefined for a missing entry deliberately declines to
      // BUILD the list -- same rule, and same reason, as CREATE_EXERCISE's onSettled in
      // queryClient.js.
      // Compare through the id map, not by raw id. `exercise` came from the CATALOG, which may
      // already carry the real server id while this person's list still holds the same exercise
      // under its temp id (the two are separate queries, refetched by separate requests, so they
      // do not flip in lockstep). Matching on `e.id === exercise.id` misses that row and appends a
      // SECOND one -- two identically-named chips in the picker, which is the exact defect this
      // whole feature exists to prevent. resolveExerciseId returns the id unchanged when there is
      // no mapping, so this is the plain comparison in every other case.
      const sameExercise = (row) =>
        row.id === exercise.id || resolveExerciseId(row.id) === resolveExerciseId(exercise.id);
      const addOrPatch = (rows) => {
        if (rows === undefined) return undefined;
        const idx = rows.findIndex(sameExercise);
        if (idx === -1) return [...rows, { tags: [], ...exercise, isFavorite: true }];
        const next = rows.slice();
        next[idx] = { ...rows[idx], isFavorite: true };
        return next;
      };
      queryClient.setQueryData(queryKeys.personExercises(personId), addOrPatch);
      // exerciseName rides along the same way ExerciseDetail's favorite does, so the outbox row
      // reads correctly without depending on the catalog cache still holding this exercise.
      favoriteMutation.mutate({ personId, exerciseId: exercise.id, exerciseName: exercise.name, favorite: true });
    }
    onSaved(exercise);
  }

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

    // Recomputed rather than reusing the render-time `resolution`: the catalog can change under an
    // open modal (a background refetch landing, another tab's create syncing), and what actually
    // happens has to match what is true NOW, not what the button said a moment ago.
    //
    // Note this runs before either gated path. An exercise that already exists always has a real,
    // synced id, so the requireSyncedExercise caller (Routines) gets what it needs from the cache
    // with no network call at all -- its gate is only needed when something must actually be
    // created.
    const resolved = resolveExerciseCreate({ catalog, name: trimmed, trackingType });
    if (resolved.kind === 'open') return openExisting(resolved.exercise);

    // Checked HERE, before dispatching, and only on the branch that would genuinely add a row.
    //
    // The server enforces the same ceiling, but this create is a DURABLE write: a 403 arriving on
    // sync is terminal, so the outbox would discard it silently -- possibly after it sat queued
    // through an entire outage, and taking every set logged against its temp id with it. Refusing
    // up front, while the person is looking at the modal, is the difference between "you have
    // reached a limit" and their workout quietly disappearing.
    //
    // Counts the account's OWN exercises only, matching countByAccount_IdAndDeletedFalse -- the
    // preloaded global catalog is shared and costs the household nothing.
    if (ownExerciseCount >= FIELD_LIMITS.maxOwnExercises) {
      showToast(`You've reached the limit of ${FIELD_LIMITS.maxOwnExercises} of your own exercises.`);
      return;
    }
    // Suffixed when the same name already exists with the OTHER measure, else the name as typed.
    const finalName = resolved.name;

    if (requireSyncedExercise) return saveSynced(finalName);

    // Every other caller (the Log tab): always take the optimistic outbox path, even while
    // genuinely online -- Save closes instantly and can never hang against a dead-but-reachable
    // backend. Mint a temp exercise so it can be selected and logged against right now, and queue
    // the durable create; the queued create + any set-logs against the temp id replay in order on
    // reconnect (or near-instantly if actually online) and resolve to the real id -- see LogTab's
    // mutation-cache subscription, which remaps the current selection from temp to real on sync.
    const tempId = newTempExerciseId();
    const tempExercise = {
      id: tempId,
      name: finalName,
      // The person's actual choice, not a hardcoded default. This temp row is what the Log screen
      // reads while the create is still queued, so a hardcoded 'strength' here would show a Reps
      // stepper for a timed exercise and log reps against it -- which the backend rejects with a
      // 400 on sync, and a 4xx permanently discards a durable write.
      trackingType,
      isGlobal: false,
      isFavorite: true,
      tags: [],
      optimistic: true,
    };
    insertOptimisticExercise(queryClient, personId, tempExercise);
    createExerciseMutation.mutate({ tempId, name: finalName, trackingType, personId, idempotencyKey: newId() });
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
        maxLength={MAX_EXERCISE_NAME_LENGTH}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: 14,
          border: `1px solid ${nameError ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 10,
          fontSize: 16,
          marginBottom: nameError || duplicateNote ? 6 : 16,
        }}
      />
      {nameError && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 12 }}>Enter an exercise name.</div>
      )}

      {/* Said BEFORE they commit, not after. An exercise that already exists is not an error -- it
          is the thing they were reaching for -- so this explains what the button below is about to
          do rather than blocking them and making them rename their way out of it. */}
      {duplicateNote && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)', lineHeight: 1.4 }}>
          {duplicateNote}
        </div>
      )}

      {/* Create-only: an exercise's measure is fixed once sets exist against it. Two options, one
          line -- the only new decision this feature asks anyone to make, and only when they are
          adding their own exercise. */}
      {!isEditing && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8 }}>
            Measured in
          </div>
          <SegmentedToggle
            ariaLabel="Measured in"
            fill
            value={trackingType}
            onChange={setTrackingType}
            options={MEASURE_OPTIONS}
          />
        </div>
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
          {isEditing ? 'Save' : openTarget ? `Open ${openLabel}` : 'Add'}
        </Button>
      </div>
    </Modal>
  );
}
