import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { queryClient } from '../lib/queryClient';
import { getUnsyncedWriteCount } from './useOutboxCount';

/**
 * Moving to another of this login's households, for every screen that offers it: the account
 * menu's "Switch to …" items, and the paused-login screen (a household that left its paid plan
 * pauses that ONE membership, so a person with another household needs a way there that does not
 * go through the app the pause has replaced).
 *
 * One hook, so the two can never disagree about what switching means. It used to live inside
 * UserMenu; a second copy on the paused screen would have been the "second way to do an existing
 * job" resilience.md forbids.
 *
 * - **Only the OTHER households.** Offering the one you are in is a control that does nothing.
 *   `accounts` is undefined on an older auth snapshot, which reads as "nowhere to go" and hides
 *   the entry rather than erroring.
 * - **Unsynced work gets a word first, and it is SUSPENSION, not destruction.** The outgoing
 *   household's queued writes stay on their own outbox key and sync when you switch back, so the
 *   confirm must never reuse logout's "will be lost" wording. The count is
 *   `getUnsyncedWriteCount` (the safety predicate), never the banner's display count — a decision
 *   about someone's data needs the honest answer, write-on-the-wire included.
 * - **Online-only by nature, with no connectivity branch.** It mints a session token, so there is
 *   nothing to queue (resilience.md's register). A failed attempt changes nothing —
 *   `establishSession` only commits once /me answers — so the person stays exactly where they were
 *   and can simply try again.
 *
 * @param {{ onSwitched?: () => void }} [options] called after a successful switch, before
 *   navigating (UserMenu closes itself there).
 */
export function useHouseholdSwitch({ onSwitched } = {}) {
  const { accounts, account, switchAccount } = useAuth();
  const navigate = useNavigate();
  // The household a switch is waiting on, once the person has been told about unsynced work.
  const [pendingSwitch, setPendingSwitch] = useState(null);
  const [switching, setSwitching] = useState(false);

  const otherAccounts = (accounts ?? []).filter(
    (h) => String(h.accountId) !== String(account?.id),
  );

  const runSwitch = useCallback(
    async (household) => {
      setPendingSwitch(null);
      setSwitching(true);
      try {
        await switchAccount(household.accountId);
        onSwitched?.();
        navigate('/app/log');
      } catch {
        // Nothing was torn down, so the person is still in the household they were in. Trying
        // again is the whole recovery; see the header.
      } finally {
        setSwitching(false);
      }
    },
    [switchAccount, onSwitched, navigate],
  );

  const requestSwitch = useCallback(
    (household) => {
      const queued = getUnsyncedWriteCount(queryClient);
      if (queued > 0) {
        setPendingSwitch({ ...household, count: queued });
        return;
      }
      runSwitch(household);
    },
    [runSwitch],
  );

  const confirmSwitch = useCallback(() => {
    if (pendingSwitch) runSwitch(pendingSwitch);
  }, [pendingSwitch, runSwitch]);

  const cancelSwitch = useCallback(() => setPendingSwitch(null), []);

  return { otherAccounts, switching, pendingSwitch, requestSwitch, confirmSwitch, cancelSwitch };
}

/** The confirm's sentence, shared so both screens say exactly the same thing. */
export function unsyncedSwitchMessage(count) {
  const lead = count === 1 ? '1 change hasn’t' : `${count} changes haven’t`;
  return `${lead} synced yet. They’ll stay saved here and sync when you switch back.`;
}
