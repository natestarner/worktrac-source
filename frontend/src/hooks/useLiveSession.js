import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLiveSession } from '../api/sessions';
import { queryKeys } from '../api/queryKeys';

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

  return { session: query.data ?? null, loading: query.isLoading, isFetching: query.isFetching, refetch };
}
