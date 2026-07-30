import { MutationObserver } from '@tanstack/react-query';

// An offline-logged set (see ExerciseDetail.jsx's `optimisticSet`/`pendingBeforeSession`) has no
// server row yet -- it's just a still-pending `logSet` mutation sitting in the outbox, keyed by
// `variables.tempId` (the optimistic row's `id`). Editing/deleting it therefore means correcting
// or cancelling that pending CREATE, not queuing a write against a set id that doesn't exist on
// the server. Already-synced sets keep the existing durable EDIT_SET/DELETE_SET path unchanged.
//
// Every function here takes `queryClient` explicitly (rather than importing the app singleton)
// because a paused `logSet` mutation lives in whichever client dispatched it -- the ambient
// QueryClientProvider's client (the singleton in production, a fresh per-test client in tests) --
// so callers must pass their own `useQueryClient()` result.

// tempId is minted with newId() and unique per set, so matching on it alone (no personId/
// exerciseId qualifier) is sufficient to find the one pending create behind an optimistic row.
function findPendingLogSet(queryClient, tempId) {
  return queryClient
    .getMutationCache()
    .getAll()
    .find((m) => m.options.mutationKey?.[0] === 'logSet' && m.state.variables?.tempId === tempId);
}

export function cancelPendingLogSet(queryClient, tempId) {
  const mutation = findPendingLogSet(queryClient, tempId);
  if (mutation) queryClient.getMutationCache().remove(mutation);
}

// Replaces the pending create's variables with the corrected weight/reps, keeping the same
// tempId, idempotencyKey, and clientLoggedAt so identity and rest-timing stay honest once it
// eventually syncs. Returns the new variables (a caller can use them to patch a cache row in
// place), or null if the set already synced out from under the edit (mutation no longer pending).
//
// Removing the old mutation and dispatching a fresh one is unavoidable here (there's no public
// TanStack API to update an in-flight Mutation's variables in place -- see the note on
// `Mutation.execute` in queryClient.js's flushOutbox, which only safely reuses the same object
// for an already-*settled* (terminal-error) mutation, not one that may still have a live retry
// loop running). That means the corrected write lands at the END of the shared outbox scope's
// live array, same as before this fix -- so within the SAME session, a write already queued
// behind the one being edited could still replay ahead of it. What this DOES fix: the new
// mutation now keeps the ORIGINAL submittedAt (read below before removing) instead of "now", so
// once outboxPersistence.js's restoreOutbox restores it after any reload, it sorts back into its
// true enqueue-order position rather than jumping to the back of the queue permanently.
export function replacePendingLogSet(queryClient, tempId, { weight, reps }) {
  const mutation = findPendingLogSet(queryClient, tempId);
  if (!mutation) return null;
  const mutationKey = mutation.options.mutationKey;
  const vars = { ...mutation.state.variables, weight, reps };
  const submittedAt = mutation.state.submittedAt;
  queryClient.getMutationCache().remove(mutation);
  const observer = new MutationObserver(queryClient, {
    ...queryClient.getMutationDefaults(mutationKey),
    mutationKey,
  });
  observer.mutate(vars).catch(() => {});
  const replacement = findPendingLogSet(queryClient, tempId);
  if (replacement) replacement.state = { ...replacement.state, submittedAt };
  return vars;
}
