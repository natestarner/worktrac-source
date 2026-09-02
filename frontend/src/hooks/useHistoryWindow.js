import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getHistoryWindow } from '../api/sessions';
import { queryKeys } from '../api/queryKeys';

// What the Free-tier window is hiding from this person: `{ windowStart, hiddenSessions,
// earliestHiddenAt }`, or `null` until the server has answered.
//
// The SERVER owns this answer. The client knows the plan (it rides in the auth snapshot and drives
// chrome), but deliberately not the 90 days -- a client that computed the boundary itself would be
// a second copy of SubscriptionService.FREE_HISTORY_WINDOW, free to drift from the clamp it is
// describing. Callers therefore ask "is anything hidden from me", never "am I past 90 days".
//
// `window` is null rather than a zero-valued default while unanswered, so a caller cannot mistake
// "nothing hidden" for "not asked yet". Both render nothing; only one of them is a fact.
export function useHistoryWindow(personId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.historyWindow(personId),
    queryFn: () => getHistoryWindow(personId),
    enabled: !!personId,
  });

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.historyWindow(personId) }),
    [queryClient, personId],
  );

  return {
    historyWindow: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    updatedAt: query.dataUpdatedAt,
    refetch,
  };
}
