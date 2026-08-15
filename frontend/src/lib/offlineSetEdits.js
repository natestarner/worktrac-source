// An offline-logged set (see ExerciseDetail.jsx's `optimisticSet`/`pendingBeforeSession`) has no
// server row yet -- it's just a still-pending `logSet` mutation sitting in the outbox, keyed by
// `variables.tempId` (the optimistic row's `id`). Deleting it before it's synced means cancelling
// that pending CREATE outright (see cancelPendingLogSet below) -- there's no server row yet to
// delete.
//
// EDITING it, by contrast, is a genuinely separate durable write (EDIT_SET, targeting the create's
// tempId -- see queryClient.js's requireResolvedSetId/setSetIdMapping) rather than a mutation of the
// queued create itself. Two reasons this replaced an earlier "rewrite the create's variables in
// place" approach:
//   1. TanStack has no public way to update an in-flight Mutation's variables, nor to cancel its
//      retry loop (see queryClient.js's flushOutbox comment on `Mutation.execute` -- reusing the
//      same object is only safe for an already-*settled* terminal-error mutation, never a `pending`
//      one that may still have a live retry loop running). The earlier approach removed the create
//      and re-dispatched a fresh one, which always re-registers at the END of the shared outbox
//      scope's live array -- reordering it ahead of the create for the rest of the session, and
//      (more subtly) letting a set logged in between compute an honest `rest_seconds` against the
//      wrong neighbor.
//   2. Re-dispatching the create with the SAME idempotencyKey is actively unsafe under lie-fi: if
//      the original create had already reached the server (response lost, or a retry landed after a
//      dropped first response), the backend's idempotency dedup (`WorkoutSetService.findDuplicate`)
//      returns the already-committed row and SILENTLY DISCARDS the new weight/reps -- the edit would
//      vanish with no error shown anywhere.
// Leaving the create alone and queuing a separate EDIT_SET write avoids both: the create keeps its
// scope position (correct ordering, honest rest_seconds), and the edit is a real, distinct write the
// server actually applies -- editing a pending set now behaves identically to editing a synced one
// in every connectivity mode, differing only in that its target id starts as a temp id and resolves
// once the create syncs. See CLAUDE.md's Offline Mode Notes for the accepted UX costs of this
// (a brief revert-then-correct flicker on reconnect, and PR celebration reflecting the pre-edit value).
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

// Display-only: patches the pending create's own `state.variables` so a screen reading straight
// from the mutation (ExerciseDetail's `pendingBeforeSession`, for a set logged before any session
// exists yet -- once a session exists the row instead reads the directly-patched `sessionSets`
// cache, see EditSetModal.jsx) shows the corrected weight/reps immediately after Save. Does NOT
// change what the CREATE eventually sends to the server -- that still commits the original values,
// by design (see the file header); the correction reaches the server via the separate EDIT_SET
// write queued alongside this call. A direct `mutation.state` assignment plus a manual cache notify
// (rather than going through TanStack's `#dispatch`, which isn't reachable from outside) so any
// mounted `useMutationState` re-renders with the correction right away instead of waiting on some
// unrelated cache event. Harmless no-op if the set already synced out from under the edit.
export function patchPendingLogSetDisplay(queryClient, tempId, { weight, reps, durationSeconds }) {
  const mutation = findPendingLogSet(queryClient, tempId);
  if (!mutation) return;
  mutation.state = {
    ...mutation.state,
    variables: { ...mutation.state.variables, weight, reps, durationSeconds },
  };
  queryClient.getMutationCache().notify({
    mutation,
    type: 'updated',
    action: { type: 'pending', variables: mutation.state.variables, isPaused: mutation.state.isPaused },
  });
}
