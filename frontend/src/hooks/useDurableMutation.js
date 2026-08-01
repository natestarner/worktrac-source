import { useMutation } from '@tanstack/react-query';
import { withEnqueueSeq } from '../lib/outboxSequence';

// A thin wrapper over useMutation for every durable (outbox-scoped) write dispatched directly from
// a component -- log-set, favorite, delete-set, save-note, create-exercise. Its only job is to
// stamp an immutable enqueueSeq into `variables` before delegating to the real `.mutate`/
// `.mutateAsync`, exactly like queryClient.js's dispatchDurableWrite does for the non-component
// dispatch path (EDIT_SET, end-workout). Making this a wrapper instead of stamping ad hoc at each
// call site means there are only two enqueue choke points in the whole app, both stamping -- no
// call site can forget. See outboxSequence.js for why enqueueSeq exists at all.
export function useDurableMutation(options) {
  const mutation = useMutation(options);
  return {
    ...mutation,
    mutate: (variables, mutateOptions) => mutation.mutate(withEnqueueSeq(variables), mutateOptions),
    mutateAsync: (variables, mutateOptions) => mutation.mutateAsync(withEnqueueSeq(variables), mutateOptions),
  };
}
