import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OUTBOX_SCOPE_ID } from '../lib/outboxPersistence';

// How many writes are currently queued in the durable outbox (paused, waiting to sync). Drives the
// "N changes waiting to sync" reassurance in the offline banner and the logout data-loss guard, and
// stays live via the mutation cache so it updates the instant a write queues or drains.
function countQueuedWrites(queryClient) {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => m.state.isPaused && m.options.scope?.id === OUTBOX_SCOPE_ID).length;
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
