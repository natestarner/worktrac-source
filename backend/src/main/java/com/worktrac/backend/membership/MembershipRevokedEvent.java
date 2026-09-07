package com.worktrac.backend.membership;

/**
 * A login was removed, or an invitation withdrawn.
 *
 * <p>⚠️ <b>This is a security control, not a courtesy.</b> Without it somebody is simply, silently
 * signed out — and per {@code offline-internals.md} their queued offline writes can then never
 * land. They deserve to know that before they wonder where their sets went.
 *
 * <p>Sent to the person losing access, never to the owner: the owner just did it.
 */
public record MembershipRevokedEvent(
        String memberEmail,
        String householdName,
        String ownerName,
        boolean wasOnlyAnInvitation) {
}
