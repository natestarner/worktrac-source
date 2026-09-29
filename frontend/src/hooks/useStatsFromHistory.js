import { useMemo } from 'react';
import { useHistory } from './useHistory';
import { useHistoryWindow } from './useHistoryWindow';
import { useLiveSession } from './useLiveSession';
import { useSessionEntries } from './useSessionEntries';
import { useExercises } from './useExercises';
import { flattenHistory } from '../lib/historySync';
import { historyDigests } from '../utils/statsFromHistory';

// What the PRs board and Trends are built from: this person's History, as the device holds it, a
// month at a time (utils/statsFromHistory.js), with the workout in progress folded in -- including
// sets that have not synced, so a record set with no signal is on the board at once, by the same
// code path as online. Nothing here reads useOnlineStatus; only the CONTENT of the caches differs
// between modes. docs/architecture/prs-trends-from-history.md.
//
// `status` is the honest answer to "can these screens show anything":
//   'ready'        History is on this device (however old -- OfflineDataNotice says how old).
//   'loading'      it is on its way.
//   'unavailable'  it is not here and not coming: offline, or the fetch keeps failing, on a device
//                  that has never held this person's History (a new device, or a trainer opening a
//                  client for the first time). Never shown as "no workouts": that would tell someone
//                  with years of training they have none.
//
// What is NOT folded in, and shows once it syncs (the same as History itself): an edit or delete
// of a set already synced that is still queued, and sets queued into a PAST workout being edited.
// The screens show OfflineDataNotice while anything is waiting.
export const LIVE_WORKOUT_ID = null;

export function useStatsFromHistory(personId) {
  // Fetched on open like the History tab (a stale History is re-checked by the ordinary sync --
  // usually one fingerprint check), so another device's change arrives when the screen is opened.
  const history = useHistory(personId, { synced: true });
  const { historyWindow } = useHistoryWindow(personId);
  const { session: live } = useLiveSession(personId);
  const { exercises } = useExercises();

  const flat = useMemo(() => flattenHistory(history.history), [history.history]);
  const serverEntries = useMemo(
    () => (live?.id ? flat.find((s) => s.id === live.id)?.entries ?? [] : []),
    [flat, live?.id],
  );
  // `confirmedAfter`: a set already saved stays folded in until History has been fetched after its
  // save, so it never drops off the board for the round trip in between (lib/confirmedSets.js).
  const entries = useSessionEntries({
    personId,
    serverEntries,
    exercises: exercises ?? [],
    liveOnly: true,
    confirmedAfter: history.updatedAt ?? 0,
  });

  // The live workout's own copy is needed only when it holds something History does not -- a set
  // still queued. Otherwise History's copy IS the workout, and every month keeps its memoized
  // digest. Keyed on the queued sets themselves, because useSessionEntries hands back a new array
  // on every render.
  //
  // NOT gated on there being a live session. The first set of a workout creates the session when
  // its save lands, so while that save is in flight there is none -- online as well as off (offline
  // there is at least the { id: null } placeholder) -- and gating on it left the board reading
  // "No PRs yet" for the whole first save. Queued live sets with no session ARE the workout being
  // started; a finished workout's queued sets are already excluded (liveOnly: isCreateInEndedWorkout).
  // Found by stats-while-saving.spec.ts's frame sampler.
  const pending = entries.flatMap((e) => e.sets.filter((s) => s.optimistic).map((s) => [e.exerciseId, s.id]));
  const pendingKey = pending.length ? JSON.stringify([live?.id ?? null, live?.startedAt ?? null, pending]) : '';

  const digests = useMemo(
    () =>
      historyDigests(history.history, {
        live: pendingKey
          ? {
              id: live?.id ?? LIVE_WORKOUT_ID,
              // A workout whose session does not exist yet has no start; it is happening now, so it
              // is dated now. Once it syncs, the server's own start replaces this.
              startedAt: live?.startedAt ?? new Date().toISOString(),
              entries,
            }
          : null,
      }),
    // `entries` is read only when pendingKey changes, which is when its content does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.history, pendingKey],
  );

  const status = history.held ? 'ready' : history.isPaused || history.isError ? 'unavailable' : 'loading';

  return {
    digests,
    status,
    historyWindow,
    isFetching: history.isFetching,
    isPaused: history.isPaused,
    isError: history.isError,
    updatedAt: history.updatedAt,
    refetch: history.refetch,
  };
}

// The viewer's zone -- what the Trends endpoints were sent as `zone`, so the device buckets weeks
// and days exactly as the server did (shared/record-rules/stats-from-history-cases.json).
export const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
