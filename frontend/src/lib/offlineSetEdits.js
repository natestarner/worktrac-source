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
export function replacePendingLogSet(queryClient, tempId, { weight, reps }) {
  const mutation = findPendingLogSet(queryClient, tempId);
  if (!mutation) return null;
  const mutationKey = mutation.options.mutationKey;
  const vars = { ...mutation.state.variables, weight, reps };
  queryClient.getMutationCache().remove(mutation);
  const observer = new MutationObserver(queryClient, {
    ...queryClient.getMutationDefaults(mutationKey),
    mutationKey,
  });
  observer.mutate(vars).catch(() => {});
  return vars;
}
