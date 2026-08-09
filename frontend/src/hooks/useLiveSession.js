import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLiveSession } from '../api/sessions';
import { queryKeys } from '../api/queryKeys';
import { isSessionEnded } from '../lib/endedSessions';

// Backed by a single shared query keyed on personId, so EVERY consumer of a person's live
// session -- the green dot on that person's pill AND the "Session in progress" banner in the Log
// tab -- reads the exact same cache entry and stays in lockstep. Previously each person pill held
// its own fetched-once-never-refreshed copy while the banner refreshed independently, which is why
// the dot drifted out of sync. Now a mutation (log a set / end a workout) invalidates this key and
// both update together.
export function useLiveSession(personId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.liveSession(personId),
    queryFn: () => getLiveSession(personId),
    enabled: !!personId,
    // The dot has to reflect reality promptly; keep it fresher than the global default and lean on
    // window-focus refetch to catch a session started/ended on another device.
    staleTime: 10 * 1000,
  });

  // Invalidates the shared key so all observers (every pill + the banner) refetch together, not
  // just this one caller's copy.
  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.liveSession(personId) }),
    [queryClient, personId],
  );

  // Suppress a session this device has already ended. The query entry can come back from the
  // persisted cache after a silent service-worker reload that beat the throttled persist of the
  // end (see endedSessions.js) -- and unlike the `{ id: null }` offline placeholder, a restored
  // one carries a REAL id, so contextSessionId would treat that finished session as live and
  // render its still-cached sets under "This session". Online this self-corrects on the next
  // refetch; offline nothing can, so the guard is what closes it.
  const session = query.data ?? null;
  const suppressed = isSessionEnded(personId, session?.id);

  return {
    session: suppressed ? null : session,
    loading: query.isLoading,
    isFetching: query.isFetching,
    refetch,
  };
}
