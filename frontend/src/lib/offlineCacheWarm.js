import { onlineManager } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import { listExercises, listPersonExercises } from '../api/exercises';
import { listTags } from '../api/tags';
import { listRoutines } from '../api/routines';
import { getLiveSession, getHistory } from '../api/sessions';

// How fresh a warmed entry needs to be before prefetchQuery bothers refetching it -- kept short
// (not the global 60s default) so the periodic re-run in useOfflineCacheWarming.js actually
// refreshes each person's data on every tick instead of skipping everyone as still-fresh.
const WARM_STALE_TIME = 30 * 1000;

// The "logging essentials" bundle per person -- just enough to log a workout and see recent
// history offline. Deliberately excludes prs/trendsOverview/exerciseTrend (the analytics fan-out
// -- high cost keyed by exercise x range, low value mid-workout) and ExerciseDetail's four
// interaction-scoped queries (exerciseSummary/sessionSets/customFields/sessionExerciseNote --
// can't be enumerated without first knowing every exercise + the live-session id; the Log tab
// reconstructs offline from the history cache + pending outbox writes instead).
function personWarmTargets(personId) {
  return [
    { queryKey: queryKeys.liveSession(personId), queryFn: () => getLiveSession(personId) },
    { queryKey: queryKeys.personExercises(personId), queryFn: () => listPersonExercises(personId) },
    { queryKey: queryKeys.routines(personId), queryFn: () => listRoutines(personId) },
    { queryKey: queryKeys.history(personId), queryFn: () => getHistory(personId) },
  ];
}

// Proactively fills the query cache for every person in the household, not just whichever
// person/tab is currently on screen, so a device hand-off (a sibling picks up the iPad) has
// something to render if connectivity drops before that person's own screens are ever visited.
// Fire-and-forget: never awaited by any render path, never throws into the UI -- a failed warm
// just leaves that entry unwarmed for the next trigger to retry.
export async function warmOfflineCache(queryClient, people) {
  if (!onlineManager.isOnline() || !people || people.length === 0) return;

  const targets = [
    { queryKey: queryKeys.exercises(), queryFn: listExercises },
    { queryKey: queryKeys.tags(), queryFn: listTags },
    ...people.flatMap((person) => personWarmTargets(person.id)),
  ];

  await Promise.allSettled(
    targets.map((target) => queryClient.prefetchQuery({ ...target, staleTime: WARM_STALE_TIME })),
  );
}
