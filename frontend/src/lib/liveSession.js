import { queryKeys } from '../api/queryKeys';
import { getLiveSession } from '../api/sessions';
import { isCreateInEndedWorkout } from './endedSessions';
import { pendingLiveSetCreates } from './queryClient';

// The ONE fetcher for queryKeys.liveSession -- useLiveSession and offlineCacheWarm both use it.
// TanStack runs whichever queryFn last set the query's options, so two fetchers for one key are
// two answers to one question; this used to be two inline `getLiveSession` calls.
//
// ## A "no live workout" that predates this device's queued sets does not erase their workout
//
// The first set of a workout seeds the `{ id: null }` placeholder (ExerciseDetail's onMutate) so
// the session bar, the person-pill dot and End workout light up before the set has synced. The
// server cannot know about that workout until one of its sets lands, so until then its honest
// answer is "none" -- and that answer used to REPLACE the placeholder:
//
//   offline mode  a fetch already on the wire when the person switched offline mode on (the network
//                 still works there) landed after their first set. The bar vanished for the whole
//                 stretch, the next set seeded a second placeholder from its own time, and the
//                 end-workout recap, which counts sets logged since the start, dropped every set
//                 before it ("2 exercises · 2 sets" for three). Seen on lower in
//                 parity-session-recap [pinned-offline]; e2e "late live-session answer" holds it.
//   online        a revalidation while the first set was still saving wiped the placeholder for
//                 that round trip -- opening the End dialog then closed it again a moment later
//                 (offline-internals.md recorded this as an accepted cost).
//
// So a fetched `null` keeps the placeholder while this person still has a live-set create that has
// not synced and is not part of a workout they already ended. Every other answer is taken as is:
//   - a real session always replaces the placeholder (that is how it gets its id);
//   - a `null` over a `null` stays `null` -- End workout writes that, and it must stand;
//   - with nothing queued, `null` clears the placeholder as before (a placeholder restored from
//     disk whose sets already synced into a workout that has since ended, say);
//   - a create the End recorded (markCreatesEnded) belongs to a finished workout, so it does not
//     hold a placeholder open -- a reload inside the 1s persist window can restore one;
//   - a create with a delete queued behind it (isDeleteQueuedFor) still counts, unlike in the
//     readers that draw sets: it lands first, and creates its workout on the server as it does.
//     The old code reached the same state, one round trip later, when LOG_SET promoted it.
//
// Not a connectivity branch: one code path, and it only ever runs on an answer the server gave.
export async function fetchLiveSession(client, personId) {
  const session = await getLiveSession(personId);
  if (session != null) return session;
  const held = client.getQueryData(queryKeys.liveSession(personId));
  if (held && held.id == null && hasQueuedLiveSets(client, personId)) return held;
  return session;
}

function hasQueuedLiveSets(client, personId) {
  return pendingLiveSetCreates(client, personId).some((tempId) => !isCreateInEndedWorkout(personId, tempId));
}
