package com.worktrac.backend.membership;

/**
 * An invitation was accepted. Two people need telling, and for different reasons.
 *
 * <p><b>The OWNER is the typo detector.</b> A mistyped invite hands a stranger read access to the
 * household's entire training history, and — because visibility is forced on for Pro/Family —
 * nothing else in the system would ever surface that. Naming the address that accepted is the only
 * way an owner can notice.
 *
 * <p><b>The MEMBER gets the household named and the one-click exit.</b> Being added to somebody
 * else's household without a way out is the shape of a trap, whatever the intent.
 */
public record MembershipAcceptedEvent(
        String memberEmail,
        String ownerEmail,
        String personName,
        String householdName,
        String ownerName) {
}
