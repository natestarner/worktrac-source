import { dispatchDurableWrite, isDeadWrite, DELETE_SET_MUTATION_KEY } from './queryClient';
import { resolveSetId } from './setIdMap';

// An offline-logged set (see ExerciseDetail.jsx's `optimisticSet`/`pendingBeforeSession`) has no
// server row yet -- it's just a still-pending `logSet` mutation sitting in the outbox, keyed by
// `variables.tempId` (the optimistic row's `id`). Deleting it before it's synced means cancelling
// that pending CREATE outright (see cancelQueuedWritesForSet below) -- there's no server row yet to
// delete -- but ONLY while the create provably never left the device. Once its request may be on
// the wire, cancelling cannot stop it landing, so the delete becomes a real DELETE_SET queued behind
// it instead (deleteQueuedSet, below).
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

// Deleting a not-yet-synced set cancels its pending CREATE -- and must take every other queued
// write that targeted that create with it, or the outbox wedges permanently.
//
// The one that matters is EDIT_SET. Correcting a still-queued set queues a genuinely separate
// durable write against the create's tempId (see this file's header, and EditSetModal.jsx). Cancel
// the create and leave that edit behind, and on reconnect it resolves a tempId the id map will
// never hold -- because the create that would have recorded the mapping never ran. requireResolvedSetId
// then throws UnresolvedSetIdError, which is deliberately STATUS-LESS and therefore retryable, so
// the write retries forever at a 30s cap. Every durable write shares one serial mutation scope, and
// a mutation in 'pending' (which includes retry backoff) never releases it -- so nothing queued
// behind it ever syncs again, including sets logged later while fully online. That is the exact
// head-of-line shape docs/incidents/2026-07-29-outbox-replay-order-deadlock.md describes.
//
// Nothing is lost by removing the edit: the create was cancelled, so no server row exists and an
// edit against it is a logical no-op. It also keeps the "waiting to sync" list honest -- deleting a
// set makes its pending correction disappear with it, rather than listing a change to a set the
// person just watched vanish.
//
// This is the ONLY removal here that a failure could ever be confused with, and it isn't one: it is
// driven by an explicit delete, never by a retry outcome. queryClient.js's dependency check is the
// backstop for every other way a create can go missing.
export function cancelQueuedWritesForSet(queryClient, tempId) {
  const cache = queryClient.getMutationCache();
  const doomed = cache
    .getAll()
    .filter(
      (m) =>
        (m.options.mutationKey?.[0] === 'logSet' && m.state.variables?.tempId === tempId) ||
        (m.options.mutationKey?.[0] === 'editSet' && m.state.variables?.setId === tempId),
    );
  doomed.forEach((m) => cache.remove(m));
}

// "Could this create's request have reached the server?" -- asked before cancelling it, because
// cancelling only removes it from the cache: a request already on the wire lands anyway, and the
// set the person just deleted survives on the server. That is what made "Remove" on the Log tab
// delete nothing when tapped mid-save (docs/incidents/2026-09-23-remove-mid-save-deleted-nothing.md).
//
// Only a create that PROVABLY never left the device is safe to cancel:
//   - never executed ('idle'), or paused before its first attempt (offline, or waiting its turn in
//     the serial outbox scope -- canRun is false) with no failed attempt behind it. A failed attempt
//     may have reached the server with only the RESPONSE lost -- lie-fi's defining case.
//   - and not restored from a page that may already have sent it -- restoreOutbox stamps
//     `mayHaveBeenSent` on those, since a re-dispatch or hydrate starts a fresh failureCount.
//   - OR dead (isDeadWrite): the server answered with a definitive refusal, or a dependency will
//     never land. Nothing was stored, and a delete queued behind it could only die with it.
// Everything else gets a real delete, queued behind it -- see deleteQueuedSet below.
function createNeverReachedServer(create) {
  const { state } = create;
  if (isDeadWrite({ status: state.status, errorStatus: state.error?.status, errorCode: state.error?.code, errorTerminal: state.error?.terminal })) {
    return true;
  }
  if (state.variables?.mayHaveBeenSent) return false;
  if (state.status === 'idle') return true;
  return state.status === 'pending' && state.isPaused && state.failureCount === 0;
}

// Delete a set that is still an optimistic row -- its create has not been confirmed. The one entry
// point for that, used by ExerciseDetail's per-set Delete and SessionSummary's Remove, so the two
// can never disagree about when cancelling is safe.
//
//   - Never sent (or dead): cancel it and everything targeting it, exactly as before. Nothing
//     reaches the server, and nothing extra sits in the outbox.
//   - Possibly sent: queue a DELETE_SET against the create's tempId. The shared serial scope runs
//     it after the create settles, and it resolves the real id through the set-id map, just as a
//     queued EDIT_SET does. Until then isDeleteQueuedFor hides the row everywhere a pending create
//     is shown or counted.
//   - Create already gone from the cache: delete by the real id if the create lived long enough to
//     record one; otherwise there is nothing on the server to delete, so just clear its edits.
export function deleteQueuedSet(queryClient, tempId, { personId, exerciseId, sessionId }) {
  const create = findPendingLogSet(queryClient, tempId);
  if (create ? createNeverReachedServer(create) : resolveSetId(tempId) === tempId) {
    cancelQueuedWritesForSet(queryClient, tempId);
    return;
  }
  dispatchDurableWrite(queryClient, DELETE_SET_MUTATION_KEY, { setId: tempId, personId, exerciseId, sessionId });
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
