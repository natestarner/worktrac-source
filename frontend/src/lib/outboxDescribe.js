import { formatSetSpaced } from '../utils/formatSet';
import { formatRestTime } from '../utils/datetime';
import { isTempExerciseId } from './exerciseIdMap';

// Turns one queued (paused, durable-outbox) mutation into human-readable text for the "waiting to
// sync" detail list behind OfflineBanner's count. Pure: every lookup (person/exercise names) is
// passed in rather than read from a query client, so every mutation kind is exhaustively
// unit-testable without a real cache. Switches on mutationKey[0] rather than assuming a fixed key
// length -- logSet is dispatched as ['logSet', personId, exerciseId] (see ExerciseDetail.jsx),
// while every other kind is dispatched with just its bare registered key (see queryClient.js).
export function describeOutboxMutation({ mutationKey, variables = {} } = {}, { peopleById = {}, exercisesById = {}, tempExerciseNames = {} } = {}) {
  const kind = mutationKey?.[0] ?? 'unknown';
  const personName = peopleById[variables.personId]?.name || 'Someone';
  // Prefer the name the dispatch site already knew (carried on the mutation's own durable
  // `variables`) over the render-time catalog lookup below. `exercisesById`/`tempExerciseNames` are
  // rebuilt from live, non-durable queries (the exercise catalog; sibling in-queue creates) that are
  // empty/refetching right after a reload -- especially in lie-fi, where that refetch can hang
  // against a dead-but-reachable backend -- so relying on them alone degrades a perfectly good
  // queued write's label to a generic "an exercise"/"a new exercise" until the catalog resolves.
  const exerciseName = variables.exerciseName || resolveExerciseName(variables.exerciseId, exercisesById, tempExerciseNames);

  switch (kind) {
    case 'logSet':
      return { kind, personName, exerciseName, detail: `logged ${formatSetSpaced(variables)}` };
    case 'createExercise':
      return { kind, personName, exerciseName: variables.name || 'a new exercise', detail: 'created this exercise' };
    case 'editSet':
      // No unit is carried on an edit (see EditSetModal.jsx) -- shown without one rather than
      // guessing and possibly showing the wrong unit for someone who logs in kg. A hold reads as
      // its time alone, which needs no unit either way.
      return {
        kind,
        personName,
        exerciseName,
        detail:
          variables.durationSeconds != null
            ? `edited a set to ${formatRestTime(variables.durationSeconds)}`
            : `edited a set to ${variables.weight} × ${variables.reps}`,
      };
    case 'deleteSet':
      return { kind, personName, exerciseName, detail: 'deleted a set' };
    case 'saveNote':
      return { kind, personName, exerciseName, detail: variables.note?.trim() ? 'updated the note' : 'cleared the note' };
    case 'endWorkout':
      return { kind, personName, exerciseName: null, detail: 'ended the workout' };
    case 'favorite':
      return { kind, personName, exerciseName, detail: variables.favorite ? 'added to favorites' : 'removed from favorites' };
    default:
      return { kind, personName, exerciseName, detail: 'a change' };
  }
}

function resolveExerciseName(exerciseId, exercisesById, tempExerciseNames) {
  if (exerciseId == null) return null;
  if (isTempExerciseId(exerciseId)) return tempExerciseNames[exerciseId] || 'a new exercise';
  return exercisesById[exerciseId]?.name || 'an exercise';
}
