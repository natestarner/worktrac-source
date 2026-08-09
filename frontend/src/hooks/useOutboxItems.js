import { useRef, useSyncExternalStore } from 'react';
import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { OUTBOX_SCOPE_ID } from '../lib/outboxPersistence';
import { byEnqueueOrder } from '../lib/outboxSequence';
import { describeOutboxMutation } from '../lib/outboxDescribe';
import { useAuth } from '../context/AuthContext';
import { useExercises } from './useExercises';

// Same predicate as useOutboxCount's countQueuedWrites -- every currently queued/struggling
// (paused, errored, or already-retried) outbox-scoped write, but here mapped into human-readable
// detail for OutboxModal rather than just counted. Sorted by `byEnqueueOrder` (the same immutable,
// app-assigned key restoreOutbox/flushOutbox reconstruct replay order with -- see
// outboxSequence.js) so the list always reads in the order changes will actually replay, including
// across a reload -- TanStack's own `submittedAt` gets re-stamped by a re-dispatch, which used to
// make the list visibly reorder (e.g. a dependency sinking below the writes that depend on it)
// even though the underlying replay order was still correct.
function readQueuedMutations(queryClient) {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => {
      if (m.options.scope?.id !== OUTBOX_SCOPE_ID) return false;
      const { isPaused, status, failureCount } = m.state;
      return isPaused || status === 'error' || failureCount > 0;
    })
    .sort(byEnqueueOrder);
}

export function useOutboxItems() {
  const queryClient = useQueryClient();
  const { people } = useAuth();
  const { exercises } = useExercises();

  // getSnapshot must return a referentially-stable value between calls unless the store actually
  // changed, or useSyncExternalStore re-renders forever (readQueuedMutations builds a fresh array
  // every call). Cache it per hook instance and only recompute when the mutation cache actually
  // notifies a change.
  const cacheRef = useRef({ snapshot: null, dirty: true });
  const mutations = useSyncExternalStore(
    (onChange) =>
      queryClient.getMutationCache().subscribe(() => {
        cacheRef.current.dirty = true;
        // Deferred, not inline -- see useSessionEntries.js for why calling onChange() directly
        // schedules a React update while a child component is mid-render.
        notifyManager.schedule(onChange);
      }),
    () => {
      if (cacheRef.current.dirty) {
        cacheRef.current.snapshot = readQueuedMutations(queryClient);
        cacheRef.current.dirty = false;
      }
      return cacheRef.current.snapshot;
    },
    () => [],
  );

  const peopleById = Object.fromEntries(people.map((p) => [p.id, p]));
  const exercisesById = Object.fromEntries(exercises.map((e) => [e.id, e]));
  // An exercise created offline won't be in the catalog yet -- its own queued createExercise
  // mutation is the only place its name lives until that write syncs.
  const tempExerciseNames = Object.fromEntries(
    mutations
      .filter((m) => m.options.mutationKey?.[0] === 'createExercise')
      .map((m) => [m.state.variables?.tempId, m.state.variables?.name])
      .filter(([tempId]) => tempId),
  );

  return mutations.map((mutation) => ({
    id: mutation.mutationId,
    ...describeOutboxMutation(
      { mutationKey: mutation.options.mutationKey, variables: mutation.state.variables },
      { peopleById, exercisesById, tempExerciseNames },
    ),
  }));
}
