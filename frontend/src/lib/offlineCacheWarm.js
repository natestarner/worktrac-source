import { onlineManager } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import { listExercises, listPersonExercises } from '../api/exercises';
import { listTags } from '../api/tags';
import { listRoutines } from '../api/routines';
import { getLiveSession, getHistory, getHistoryWindow } from '../api/sessions';
import { getPrs } from '../api/stats';

// How fresh a warmed entry needs to be before prefetchQuery bothers refetching it -- kept short
// (not the global 60s default) so the periodic re-run in useOfflineCacheWarming.js actually
// refreshes each person's data on every tick instead of skipping everyone as still-fresh.
const WARM_STALE_TIME = 30 * 1000;

// The "logging essentials" bundle per person -- just enough to log a workout, see recent
// history, and check PRs offline. Deliberately excludes trendsOverview/exerciseTrend (the
// analytics fan-out -- high cost keyed by exercise x range, low value mid-workout) and
// ExerciseDetail's session-scoped queries (sessionSets/customFields/sessionExerciseNote --
// can't be enumerated without first knowing the live/edit session id). exerciseSummary
// (Exercise Detail's "Last time"/"Best est. 1RM" card) is likewise not prefetched here, but for
// a different reason: it's derived client-side from the already-warmed history cache when the
// live query has no answer yet (offline or lie-fi) -- see deriveExerciseSummaryFromHistory.js
// and ExerciseDetail.jsx -- rather than fanning out a prefetch per exercise.
// `refreshAfterRestore` marks the entries a boot warm must refetch even when they still look
// fresh. A restored entry's dataUpdatedAt describes the PREVIOUS page session, and the query
// persister is throttled (1s), so anything that changed in that last second was never written --
// yet the timestamp still says "fresh", and both this warm's staleTime and the queries' own 60s
// staleTime then decline to refetch it. Nothing else corrects it until the 5-minute warm tick.
// That is issue #146: a routine created seconds before a reload vanished from the Routines tab.
//
// It is opt-IN per key rather than blanket, because forcing is only safe for collections the
// server wholly owns. These three qualify:
//   - routines       -- routine CRUD is online-gated (OfflineDisabledWrap), so the cache can
//                       never hold a routine that hasn't reached the server.
//   - history, prs   -- no optimistic writer anywhere; they are invalidation-driven only, so an
//                       unsynced set is simply absent from them (see "a durable write is not the
//                       same as a visible value" in .claude/rules/frontend-core.md).
//   - historyWindow  -- same reason, one step further: it is a pure server-side derivation of the
//                       billing state and the clock, so the client could not hold an unsent
//                       version of it even in principle.
//
// historyWindow is warmed at all -- unlike trends, which is deliberately excluded -- because it is
// one small row per person, and because without it the three clamped tabs would silently lose the
// "there is more here than you can see" notice for a whole outage. A screen that goes back to
// looking complete while offline is exactly the second code path resilience.md exists to prevent.
//
// The others are deliberately excluded because they CAN hold unsynced local state, and refetching
// would delete it mid-flight:
//   - exercises, personExercises -- insertOptimisticExercise (AddEditExerciseModal) puts a temp
//                       exercise in both while its create is still queued in the outbox.
//   - liveSession    -- EndWorkoutConfirmModal optimistically nulls it on end-workout.
function personWarmTargets(personId) {
  return [
    { queryKey: queryKeys.liveSession(personId), queryFn: () => getLiveSession(personId) },
    { queryKey: queryKeys.personExercises(personId), queryFn: () => listPersonExercises(personId) },
    { queryKey: queryKeys.routines(personId), queryFn: () => listRoutines(personId), refreshAfterRestore: true },
    { queryKey: queryKeys.history(personId), queryFn: () => getHistory(personId), refreshAfterRestore: true },
    { queryKey: queryKeys.prs(personId), queryFn: () => getPrs(personId), refreshAfterRestore: true },
    { queryKey: queryKeys.historyWindow(personId), queryFn: () => getHistoryWindow(personId), refreshAfterRestore: true },
  ];
}

// Proactively fills the query cache for every person in the household, not just whichever
// person/tab is currently on screen, so a device hand-off (a sibling picks up the iPad) has
// something to render if connectivity drops before that person's own screens are ever visited.
// Fire-and-forget: never awaited by any render path, never throws into the UI -- a failed warm
// just leaves that entry unwarmed for the next trigger to retry.
// `afterRestore` is set only by the boot warm (see useOfflineCacheWarming), which runs once the
// persisted cache has finished hydrating. It downgrades staleTime to 0 for the
// refreshAfterRestore keys above, so they refetch rather than being skipped as still-fresh.
export async function warmOfflineCache(queryClient, people, { afterRestore = false } = {}) {
  if (!onlineManager.isOnline() || !people || people.length === 0) return;

  const targets = [
    { queryKey: queryKeys.exercises(), queryFn: listExercises },
    { queryKey: queryKeys.tags(), queryFn: listTags },
    ...people.flatMap((person) => personWarmTargets(person.id)),
  ];

  await Promise.allSettled(
    targets.map(({ refreshAfterRestore, ...target }) =>
      queryClient.prefetchQuery({
        ...target,
        staleTime: afterRestore && refreshAfterRestore ? 0 : WARM_STALE_TIME,
      }),
    ),
  );
}
