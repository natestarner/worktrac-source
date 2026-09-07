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

/**
 * How many people the warm fans out over, at most.
 *
 * ⚠️ THIS IS A REDUCTION, and the trade is deliberate. The warm used to cover EVERY person in the
 * household unconditionally -- six queries each, so a 30-athlete team would fire 182 prefetches on
 * every boot, every reconnect, every tab-focus and every five-minute tick. That is untenable at
 * Team-tier scale and was never sized for it.
 *
 * <p>What it costs: in a household larger than this cap, a device hand-off to somebody outside the
 * warmed set has nothing cached if connectivity drops before their screens are ever visited. That
 * is a real regression for that person, accepted because the alternative is a prefetch storm that
 * degrades the app for everyone.
 *
 * <p>Six is chosen so **nothing changes for the households this product actually has today** -- a
 * family of 2-5 is entirely inside the cap, so their warm is byte-for-byte what it was.
 */
export const MAX_WARMED_PEOPLE = 6;

/**
 * Who to warm, in priority order: the viewer, then whoever is on screen, then the rest.
 *
 * ⚠️ <b>The plan called for "most-recently-active first" and that is NOT what this does</b>, because
 * the data does not exist: {@code PersonDto} carries no last-active timestamp, and inventing one
 * client-side from the query cache would be circular (the cache is what we are deciding how to
 * fill). Rather than approximate recency badly, the two people who are certainly worth warming are
 * named explicitly and the remainder keep the household's own order.
 *
 * <p>At Team-tier scale that remainder is the part worth improving, and it is the seam to do it at:
 * add a real signal to the roster and sort here. For a family it is moot -- everyone fits.
 */
export function peopleToWarm(people, { selfPersonId = null, activePersonId = null } = {}) {
  const byPriority = [];
  const seen = new Set();

  const take = (id) => {
    if (id == null || seen.has(String(id))) return;
    const person = people.find((p) => String(p.id) === String(id));
    if (!person) return;
    seen.add(String(person.id));
    byPriority.push(person);
  };

  // The viewer first: it is the one person guaranteed to be worth having, and for a member it is
  // the only person they can write to.
  take(selfPersonId);
  // Then whoever is on screen -- the same person for an owner who has not switched, in which case
  // `seen` makes this a no-op.
  take(activePersonId);

  for (const person of people) {
    if (byPriority.length >= MAX_WARMED_PEOPLE) break;
    take(person.id);
  }

  return byPriority.slice(0, MAX_WARMED_PEOPLE);
}

// Proactively fills the query cache for the people most likely to be needed, not just whichever
// person/tab is currently on screen, so a device hand-off (a sibling picks up the iPad) has
// something to render if connectivity drops before that person's own screens are ever visited.
// Bounded by MAX_WARMED_PEOPLE -- see peopleToWarm for what that costs and why.
// Fire-and-forget: never awaited by any render path, never throws into the UI -- a failed warm
// just leaves that entry unwarmed for the next trigger to retry.
// `afterRestore` is set only by the boot warm (see useOfflineCacheWarming), which runs once the
// persisted cache has finished hydrating. It downgrades staleTime to 0 for the
// refreshAfterRestore keys above, so they refetch rather than being skipped as still-fresh.
export async function warmOfflineCache(
  queryClient,
  people,
  { afterRestore = false, selfPersonId = null, activePersonId = null } = {},
) {
  if (!onlineManager.isOnline() || !people || people.length === 0) return;

  const targets = [
    { queryKey: queryKeys.exercises(), queryFn: listExercises },
    { queryKey: queryKeys.tags(), queryFn: listTags },
    ...peopleToWarm(people, { selfPersonId, activePersonId })
      .flatMap((person) => personWarmTargets(person.id)),
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
