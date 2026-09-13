import { useMutationState } from '@tanstack/react-query';
import { useHistory } from './useHistory';
import { useLiveSession } from './useLiveSession';
import { LOG_SET_MUTATION_KEY } from '../lib/queryClient';

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
export function useSessionRecap(personId) {
  const { session } = useLiveSession(personId);
  const { history } = useHistory(personId);

  // Every log-set write, INCLUDING successful ones -- that is the whole point. Excluding them is
  // what created the online race above.
  const logSetVars = useMutationState({
    filters: { mutationKey: LOG_SET_MUTATION_KEY },
    select: (mutation) => mutation.state.variables,
  });

  const sessionId = session?.id ?? null;
  const startedAt = session?.startedAt ?? null;
  const serverEntries = sessionId ? (history.find((s) => s.id === sessionId)?.entries ?? []) : [];

  const countsByExercise = new Map();
  for (const entry of serverEntries) {
    countsByExercise.set(entry.exerciseId, entry.sets.length);
  }

  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const pendingCounts = new Map();
  for (const vars of logSetVars) {
    if (!vars || vars.personId !== personId || !vars.exerciseId) continue;
    // A stale mutation from an EARLIER workout can still be in the cache until it is collected;
    // without this the recap would count last night's sets into this morning's workout.
    if (startedMs !== null && vars.clientLoggedAt) {
      const loggedMs = new Date(vars.clientLoggedAt).getTime();
      if (Number.isFinite(loggedMs) && loggedMs < startedMs) continue;
    }
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
