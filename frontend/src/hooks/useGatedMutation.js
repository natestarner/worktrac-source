import { useCallback, useState } from 'react';
import { useRequireOnline } from './useRequireOnline';
import { useUI } from '../context/UIContext';

// The Tier-3 counterpart to useDurableMutation: one mechanism for every write that is deliberately
// online-only (account/person management, settings, exercise customization, routines, exports,
// retroactive past-workout entry). Those stay gated rather than durable because some of them --
// createPastSession above all -- are NOT idempotent and would duplicate on replay.
//
// Before this existed, Tier-3 had no shared abstraction at all. Thirty-five components called the
// api/ layer directly, each inventing its own handling: most wrapped the call in `try { … } finally
// { setBusy(false) }` with **no catch**, so a failed write rejected into nothing and the person saw
// the spinner stop and simply nothing happen; RoutinesTab's delete had no try at all. That is the
// one outcome the degraded-conditions contract forbids outright -- a failure must degrade to
// something the person can see and act on, never to silence.
//
// Composes the two existing pieces rather than replacing them: useRequireOnline still supplies the
// offline gate and its calm toast (and OfflineDisabledWrap still greys out entry points up front),
// so this only adds the two things every call site was open-coding or omitting -- a pending flag
// and an error path.
//
// Deliberately NOT a TanStack useMutation: these writes must never enter the outbox scope, and
// scripts/check-resilience-invariants.sh enforces that useMutation appears in exactly one file.
//
//   const { online, pending, run } = useGatedMutation();
//   const handleDelete = run(
//     async (routine) => { await removeRoutine(personId, routine.id); refetch(); },
//     { offlineMessage: 'Deleting a routine needs a connection.',
//       errorMessage: "Couldn't delete that routine." },
//   );
export function useGatedMutation(defaults = {}) {
  const { online, requireOnline } = useRequireOnline();
  const { showToast } = useUI();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    (action, options = {}) => {
      const offlineMessage = options.offlineMessage ?? defaults.offlineMessage;
      const errorMessage =
        options.errorMessage ?? defaults.errorMessage ?? "That didn't save. Try again.";

      // requireOnline wraps the whole thing, so an offline attempt shows its own calm toast and
      // never reaches the network -- exactly as before, just with the error path added underneath.
      return requireOnline(async (...args) => {
        setPending(true);
        try {
          return await action(...args);
        } catch (error) {
          // A Tier-3 write is gated on being online, so a failure here is the server's answer or a
          // connection that dropped mid-request. Either way there is nothing queued and nothing
          // retrying -- the person has to know, or they will believe it saved.
          console.error('Gated write failed', error);
          showToast(errorMessage, { tone: 'error' });
          return undefined;
        } finally {
          setPending(false);
        }
      }, offlineMessage);
    },
    // defaults is a fresh object literal at most call sites, so depending on it directly would
    // rebuild `run` every render. The two strings are what actually matter.
    [requireOnline, showToast, defaults.offlineMessage, defaults.errorMessage],
  );

  return { online, pending, run };
}
