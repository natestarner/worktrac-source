import { useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isTempExerciseId } from '../lib/exerciseIdMap';
import { isUnsyncedWrite } from '../lib/queryClient';

// Every not-yet-synced logSet/createExercise mutation, for ANY person -- the only place an
// offline-logged set exists before it syncs (see offlineSetEdits.js). Covers the brief online
// in-flight window too, so a set never vanishes from the list for the split second between
// dispatch and the confirmed refetch landing. Membership is isUnsyncedWrite (shared with
// ExerciseDetail), so a write that is paused, retrying, OR sitting in a transient error all count
// the same -- see the predicate's own comment in lib/queryClient.js.
//
// Deliberately NOT filtered by personId here -- this is the useSyncExternalStore snapshot, which
// is only recomputed when the mutation cache actually changes (see the dirty-flag cache below), not
// when the personId argument changes. Filtering by person here would return the PREVIOUS person's
// stale snapshot for a full render cycle after switching people (until some unrelated mutation-cache
// event happened to fire and force a recompute) -- exactly the "bleeds across people until you log a
// new set" bug this fixes. The person filter instead lives in the render body below, which re-runs
// on every render including a personId change.
function readPendingMutations(queryClient) {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => {
      const kind = m.options.mutationKey?.[0];
      if (kind !== 'logSet' && kind !== 'createExercise') return false;
      // isUnsyncedWrite, not `status === 'pending'` -- under lie-fi a write's retries settle into
      // 'error' while it stays queued and durable, and this list used to silently drop it there
      // even though ExerciseDetail still showed the row and the outbox badge still counted it.
      return isUnsyncedWrite({ status: m.state.status, errorStatus: m.state.error?.status });
    });
}

function resolveExerciseName(exerciseId, exercisesById, tempExerciseNames, carriedName) {
  // The dispatch site's own carried name (see ExerciseDetail.jsx's logSetMutation.mutate) beats the
  // catalog/temp-name lookups below, which are rebuilt from live queries that are empty/refetching
  // right after a reload -- see outboxDescribe.js for the same reasoning.
  if (carriedName) return carriedName;
  if (isTempExerciseId(exerciseId)) return tempExerciseNames[exerciseId] || 'a new exercise';
  return exercisesById[exerciseId]?.name || 'an exercise';
}

// The Log tab's "Session exercises" list (SessionSummary.jsx) is normally sourced entirely from
// the server `history` query (see LogTab.jsx). Offline -- or in the instant before an online
// write settles -- the server has no record of these sets at all; they exist only as pending
// mutations. This merges those in by exerciseId so the list is never empty just because nothing
// has synced yet. Online steady-state (no pending mutations) this is a no-op: it returns
// `serverEntries` unchanged.
export function useSessionEntries({ personId, serverEntries, exercises }) {
  const queryClient = useQueryClient();

  // getSnapshot must return a referentially-stable value between calls unless the mutation cache
  // actually changed, or useSyncExternalStore re-renders forever -- same fix as useOutboxItems.js.
  const cacheRef = useRef({ snapshot: null, dirty: true });
  const allMutations = useSyncExternalStore(
    (onChange) =>
      queryClient.getMutationCache().subscribe(() => {
        cacheRef.current.dirty = true;
        onChange();
      }),
    () => {
      if (cacheRef.current.dirty) {
        cacheRef.current.snapshot = readPendingMutations(queryClient);
        cacheRef.current.dirty = false;
      }
      return cacheRef.current.snapshot;
    },
    () => [],
  );

  // Scoped to the active person on every render (not memoized) -- this is what makes a person
  // switch take effect immediately instead of showing the previous person's pending sets.
  const mutations = allMutations.filter((m) => m.state.variables?.personId === personId);

  const exercisesById = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const tempExerciseNames = Object.fromEntries(
    mutations
      .filter((m) => m.options.mutationKey?.[0] === 'createExercise')
      .map((m) => [m.state.variables?.tempId, m.state.variables?.name])
      .filter(([tempId]) => tempId),
  );

  const pendingByExercise = new Map();
  for (const m of mutations) {
    if (m.options.mutationKey?.[0] !== 'logSet') continue;
    const vars = m.state.variables;
    if (!vars) continue;
    if (!pendingByExercise.has(vars.exerciseId)) {
      pendingByExercise.set(vars.exerciseId, {
        exerciseId: vars.exerciseId,
        exerciseName: resolveExerciseName(vars.exerciseId, exercisesById, tempExerciseNames, vars.exerciseName),
        sets: [],
      });
    }
    pendingByExercise.get(vars.exerciseId).sets.push({
      id: vars.tempId,
      weight: vars.weight,
      reps: vars.reps,
      unit: vars.unit,
      optimistic: true,
    });
  }

  // Clone rather than mutate -- serverEntries comes straight from the history query cache, which
  // must never be written to outside a query update.
  const merged = serverEntries.map((entry) => ({ ...entry, sets: [...entry.sets] }));
  const mergedByExerciseId = new Map(merged.map((entry) => [entry.exerciseId, entry]));
  for (const [exerciseId, pendingEntry] of pendingByExercise) {
    const existing = mergedByExerciseId.get(exerciseId);
    if (existing) existing.sets.push(...pendingEntry.sets);
    else merged.push(pendingEntry);
  }
  return merged;
}
