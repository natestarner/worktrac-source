import { useMutationState } from '@tanstack/react-query';
import { useHistory } from './useHistory';
import { useLiveSession } from './useLiveSession';
import { LOG_SET_MUTATION_KEY, DELETE_SET_MUTATION_KEY } from '../lib/queryClient';

// What the active person has actually done in the live workout: how many exercises, how many sets,
// and when it started.
//
// ## Why this does NOT use useSessionEntries, having originally done so
//
// `useSessionEntries` merges server `history` entries with the **unsynced** log-set mutations
// (`isUnsyncedWrite`), which is exactly right for the Log tab's list: a synced set is already in
// `history`, so counting its mutation too would double it.
//
// It is wrong for the recap, and wrong in the one mode that looks safest. A set leaves the unsynced
// set the instant its write SUCCEEDS, while `history` only catches up on the refetch that
// `LOG_SET`'s invalidation triggers. Between those two moments the set exists in neither source.
//
//   degraded  the writes stay pending for the whole outage, so they are always countable  ✅
//   online    the writes succeed immediately, and the recap then races the history refetch  ❌
//
// Locally that refetch lands in milliseconds and the race is almost never lost. Against the lower
// environment it is lost reliably: `parity-session-recap` failed all three attempts in `[online]`
// while all three degraded modes passed -- the exact inversion of where anyone would look first.
// This is the hazard log-screen.md describes for anything derived from `history`, arrived at from
// the other direction: I built the fallback for the offline case and missed that online is the slow
// path here.
//
// ## What it does instead
//
// Counts BOTH sources and takes the larger per exercise. Each is a lower bound on the truth in a
// different window -- `history` lags a just-synced set, the mutation cache lags nothing but is
// garbage-collected eventually -- so a max is correct where a sum would double-count and either
// alone is sometimes short. It also handles a PARTIAL history (two of three sets landed), which an
// either/or fallback would not.
//
// Mutations are scoped by `clientLoggedAt >= session.startedAt` rather than by `sessionId`: a set
// logged offline carries `sessionId: null` for the person's entire outage (log-screen.md), so
// scoping on it would drop precisely the rows the degraded modes depend on. Every live-set write
// carries `clientLoggedAt`.
//
// The exercise catalog is no longer read at all. It was only ever there to resolve NAMES for
// useSessionEntries' rows, and the recap counts rather than names things -- so dropping it also
// drops an observer this modal never needed.
//
// Mounted from EndWorkoutConfirmModal rather than SessionBar, so its history observer lives only
// while the modal is open -- the same split as OfflineBanner's OutboxModalContainer.
//
// ## Deleting a set must net out of the mutation-cache fallback too
//
// The max-per-exercise trick above assumes a count can only ever be a LOWER bound that grows
// toward the truth as sources catch up. Deleting an already-synced set breaks that assumption:
// `history` drops it (correctly), but the LOG_SET mutation that created it keeps sitting in the
// mutation cache -- it already succeeded, so it is exactly the kind of write the max is designed
// to keep counting. Without accounting for the delete, `Math.max` picks the stale, too-high
// mutation-cache count forever, and "log some sets, delete them all, end the workout" reports the
// deleted sets instead of nothing. `formatSessionRecap` even documents the intended behaviour for
// this case ("a mis-tap on 'Log set' that was then deleted") -- this is what actually delivers it.
//
// DELETE_SET's own variables carry the real `setId` it targeted (SessionSummary.jsx's "remove
// exercise", ExerciseDetail.jsx's per-set Delete button), and a DELETE_SET write is only ever
// reachable against an already-synced set
// (queryClient.js's DELETE_SET comment), so matching by that id is exact -- no session/time
// scoping needed the way LOG_SET's `clientLoggedAt` guard is. Both sources below drop any set
// whose real id has a successful-or-inflight delete against it, so the same fix closes the race in
// both directions: a delete that outran `history`'s refetch, and a delete that outran eviction of
// its target's original LOG_SET mutation from the cache.
export function useSessionRecap(personId) {
  const { session } = useLiveSession(personId);
  const { history } = useHistory(personId);

  // Every log-set write, INCLUDING successful ones -- that is the whole point. Excluding them is
  // what created the online race above. `data` rides along so a set later deleted (its real id
  // turns up in a DELETE_SET's variables) can be recognised and excluded, below.
  const logSetMutations = useMutationState({
    filters: { mutationKey: LOG_SET_MUTATION_KEY },
    select: (mutation) => ({ vars: mutation.state.variables, data: mutation.state.data }),
  });

  // A DELETE_SET write lingers in the mutation cache the same way a LOG_SET one does. Every
  // occurrence counts, not just settled ones: the set is gone from "what this workout has" the
  // moment the delete is dispatched, same as any other durable write is treated as committed.
  const deleteSetVars = useMutationState({
    filters: { mutationKey: DELETE_SET_MUTATION_KEY },
    select: (mutation) => mutation.state.variables,
  });

  const sessionId = session?.id ?? null;
  const startedAt = session?.startedAt ?? null;
  const serverEntries = sessionId ? (history.find((s) => s.id === sessionId)?.entries ?? []) : [];

  const deletedSetIds = new Set(
    deleteSetVars.filter((vars) => vars?.personId === personId && vars?.setId != null).map((vars) => vars.setId),
  );

  const countsByExercise = new Map();
  for (const entry of serverEntries) {
    const n = entry.sets.filter((s) => !deletedSetIds.has(s.id)).length;
    if (n > 0) countsByExercise.set(entry.exerciseId, n);
  }

  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const pendingCounts = new Map();
  for (const { vars, data } of logSetMutations) {
    if (!vars || vars.personId !== personId || !vars.exerciseId) continue;
    // A stale mutation from an EARLIER workout can still be in the cache until it is collected;
    // without this the recap would count last night's sets into this morning's workout.
    if (startedMs !== null && vars.clientLoggedAt) {
      const loggedMs = new Date(vars.clientLoggedAt).getTime();
      if (Number.isFinite(loggedMs) && loggedMs < startedMs) continue;
    }
    // A set logged and then deleted within the same workout must not count -- see above.
    if (data?.set?.id != null && deletedSetIds.has(data.set.id)) continue;
    pendingCounts.set(vars.exerciseId, (pendingCounts.get(vars.exerciseId) ?? 0) + 1);
  }

  for (const [exerciseId, n] of pendingCounts) {
    countsByExercise.set(exerciseId, Math.max(countsByExercise.get(exerciseId) ?? 0, n));
  }

  let setCount = 0;
  for (const n of countsByExercise.values()) setCount += n;

  return {
    exerciseCount: countsByExercise.size,
    setCount,
    startedAt,
  };
}
