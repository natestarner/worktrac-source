import { useAuth } from '../context/AuthContext';

// The client's single answer to "what may this login do here?", read from /me's `membership`.
//
// ⚠️ CHROME ONLY. The server has already decided: every list is filtered by PersonService.list and
// every write is refused by requireWritablePerson before anything here is consulted. What this
// buys is a client that does not offer a control it knows will be refused. It is the same
// relationship AccountDto.plan has with SubscriptionService.isPro, and it carries the same
// warning -- never treat it as the authority, and never derive a permission from it that the
// server did not state.
//
// ── WHY UNKNOWN FAILS OPEN ────────────────────────────────────────────────────────────────────
// `membership` is null in two situations, and the right answer for both is "assume full access":
//
//   1. A v1 auth snapshot, adopted at offline boot (see lib/authSnapshot.js). Every v1 snapshot
//      predates member logins entirely, so its holder IS their household's owner. Failing closed
//      would tell an owner, offline, that they may not edit their own household -- and they would
//      have no way to prove otherwise until they got a connection.
//   2. A signed-out or still-booting render, where nothing is drawn from it anyway.
//
// This mirrors AppSettingsTab's deliberate `plan !== 'FREE'` fail-open, for the same reason: a
// paying household must not be told its own feature is gone because a snapshot predates the field.
// The cost of being wrong is bounded and small -- a member briefly sees a control that then
// returns 403 -- because the server, not this hook, is what actually refuses.
export function useAccountAccess() {
  const { membership, people } = useAuth();

  const isMember = membership?.accountRole === 'MEMBER';
  const selfPersonId = membership?.personId ?? null;

  return {
    isMember,
    isOwner: !isMember,
    /** The person this login IS, if any. Identity, never authority — go through canWritePerson. */
    selfPersonId,
    /**
     * True when this login may change that person's training data.
     *
     * <p>A null/undefined personId answers true: it means "no specific person", which is the shape
     * a control has before a person is selected, and blocking there would disable the app during
     * the one frame between mount and auto-select.
     */
    canWritePerson(personId) {
      if (!isMember || personId == null) return true;
      return selfPersonId != null && String(selfPersonId) === String(personId);
    },
    /**
     * The people this login can see — already filtered by the server.
     *
     * <p>Re-exported here so a screen reaching for "who can I see" lands on the same list as
     * everything else rather than being tempted to filter `people` itself.
     */
    visiblePeople: people,
  };
}
