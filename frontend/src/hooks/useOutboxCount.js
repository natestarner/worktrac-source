import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OUTBOX_SCOPE_ID } from '../lib/outboxPersistence';

// How many writes are currently queued/struggling in the durable outbox. Drives the "N changes
// waiting to sync" reassurance in the offline banner and the logout data-loss guard, and stays live
// via the mutation cache so it updates the instant a write queues, retries, or drains.
//
// Counts paused (offline), terminally errored, or already-retried-at-least-once writes -- but NOT a
// brand-new online first attempt (pending, not paused, failureCount 0), so a normal fast successful
// log-set doesn't flash the banner for the ~100ms it's in flight. That write is still fully durable
// either way (see outboxPersistence.js) -- this filter only affects what's SHOWN, not what's safe.
function countQueuedWrites(queryClient) {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => {
      if (m.options.scope?.id !== OUTBOX_SCOPE_ID) return false;
      const { isPaused, status, failureCount } = m.state;
      return isPaused || status === 'error' || failureCount > 0;
    }).length;
}

export function useOutboxCount() {
  const queryClient = useQueryClient();
  return useSyncExternalStore(
    (onChange) => queryClient.getMutationCache().subscribe(onChange),
    () => countQueuedWrites(queryClient),
    () => 0,
  );
}

// Non-hook read for imperative checks (e.g. the logout guard deciding whether to warn).
export function getQueuedWriteCount(queryClient) {
  return countQueuedWrites(queryClient);
}
