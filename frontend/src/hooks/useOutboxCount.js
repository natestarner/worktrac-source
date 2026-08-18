import { useSyncExternalStore } from 'react';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { OUTBOX_SCOPE_ID } from '../lib/outboxPersistence';
import { isUnsyncedWrite } from '../lib/queryClient';

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
    // notifyManager.schedule, not onChange directly -- see useSessionEntries.js for why.
    (onChange) => queryClient.getMutationCache().subscribe(() => notifyManager.schedule(onChange)),
    () => countQueuedWrites(queryClient),
    () => 0,
  );
}

// Non-hook read of the DISPLAY count above.
export function getQueuedWriteCount(queryClient) {
  return countQueuedWrites(queryClient);
}

// "Would anything be destroyed if this device's outbox were thrown away right now?" -- the SAFETY
// counterpart to countQueuedWrites, and deliberately a DIFFERENT question from it.
//
// countQueuedWrites answers "what should I show the user", and to keep the banner from flashing on
// every fast online write it excludes a brand-new first attempt that is still in flight. That is
// correct for a banner and wrong for a destructive action: a write on the wire has not reached the
// server yet, and `logout()` clears both the in-memory outbox and its persisted copy, so if that
// request fails there is nothing left to retry from. The window is narrow -- the shared serial
// scope means at most one write is ever in flight, so this is only the LAST write of a drain --
// but AuthContext's logout comment states outright that UserMenu "warns first when the outbox is
// non-empty, so this is a confirmed choice, not silent data loss", and that invariant only holds
// if the predicate behind the warning is this one.
//
// isUnsyncedWrite is the app-wide answer to "has this write NOT reached the server yet?" (see
// .claude/rules/resilience.md's mechanism table) -- reused here rather than re-derived, so the
// guard can never drift from what every screen means by "unsynced".
function countUnsyncedWrites(queryClient) {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter(
      (m) =>
        m.options.scope?.id === OUTBOX_SCOPE_ID &&
        isUnsyncedWrite({ status: m.state.status, errorStatus: m.state.error?.status }),
    ).length;
}

// Non-hook read for the logout data-loss guard. Deliberately NOT getQueuedWriteCount -- see above.
export function getUnsyncedWriteCount(queryClient) {
  return countUnsyncedWrites(queryClient);
}
