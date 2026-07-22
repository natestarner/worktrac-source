import { get, set, del } from 'idb-keyval';
import { dehydrate, hydrate } from '@tanstack/react-query';

// The durable write outbox: paused (queued-while-offline) mutations, persisted to their OWN
// IndexedDB key -- deliberately separate from the query cache's persister.
//
// Why separate (hardening #1): the query cache is discarded on restore if it's older than its
// `maxAge` (1 day) or if `QUERY_CACHE_BUSTER` changes (which it does on an app update). Unsynced
// WRITES must survive both -- a >24h offline gap, or shipping a new build while a user holds queued
// writes -- so they cannot live in that same age-limited, buster-gated blob. This store has no age
// limit and no buster: a queued write persists until it actually syncs.
//
// Only PAUSED, outbox-enabled mutations are persisted. "Paused" (the canonical TanStack recipe) means
// the write couldn't reach the server and is waiting to replay. "Outbox-enabled" means it carries
// the shared `offline-outbox` scope, which is exactly the set of mutations that ALSO have a
// `setMutationDefaults` mutationFn registered by key (see queryClient.js) -- so on restore the
// function, retry, and reconciliation (none of which serialize) are re-attached and the write can
// actually replay. A paused mutation without that scope (e.g. a not-yet-converted write) is
// deliberately skipped rather than persisted un-replayably.
const OUTBOX_KEY = 'worktrac-outbox';
export const OUTBOX_SCOPE_ID = 'offline-outbox';

const idbAvailable = typeof indexedDB !== 'undefined';

function dehydrateOutbox(queryClient) {
  return dehydrate(queryClient, {
    shouldDehydrateQuery: () => false,
    shouldDehydrateMutation: (mutation) =>
      mutation.state.isPaused && mutation.options.scope?.id === OUTBOX_SCOPE_ID,
  });
}

// Write the current queued writes to disk immediately. Called eagerly on every mutation-cache
// change AND on pagehide/visibilitychange (hardening #6) -- no throttle, so a set logged and the app
// swipe-killed a fraction of a second later is already durable.
export function persistOutboxNow(queryClient) {
  if (!idbAvailable) return;
  const dehydrated = dehydrateOutbox(queryClient);
  if (dehydrated.mutations.length > 0) {
    set(OUTBOX_KEY, dehydrated).catch(() => {});
  } else {
    // Nothing queued -> clear the key so a stale outbox can't be replayed later.
    del(OUTBOX_KEY).catch(() => {});
  }
}

// Subscribe the outbox to the mutation cache and to app-exit events. Returns a cleanup function.
export function attachOutboxPersistence(queryClient) {
  if (!idbAvailable) return () => {};
  const unsubscribe = queryClient.getMutationCache().subscribe(() => persistOutboxNow(queryClient));
  const flush = () => persistOutboxNow(queryClient);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', flush);
  };
}

// Rehydrate queued writes into the mutation cache on app boot. They come back paused; the caller
// resumes them (see resumeOutbox in queryClient.js) once connectivity is confirmed.
export async function restoreOutbox(queryClient) {
  if (!idbAvailable) return;
  try {
    const dehydrated = await get(OUTBOX_KEY);
    if (dehydrated?.mutations?.length) hydrate(queryClient, dehydrated);
  } catch {
    // A corrupt/unreadable outbox must never crash boot; the durable store is best-effort.
  }
}

export function clearOutbox() {
  if (!idbAvailable) return Promise.resolve();
  return del(OUTBOX_KEY).catch(() => {});
}
