package com.worktrac.backend.user;

/**
 * Somebody changed how a login signs in. The owner of the login is emailed, at the login's own
 * address, so a change they did not make is noticed — the way Google, Apple and banks do.
 *
 * <p>⚠️ <b>A security control, not a courtesy.</b> The person reading it may be the one locked out:
 * a stolen session can connect its own Google account, change the password, or disconnect the way
 * back in. Each of those is published from inside the transaction that made the change, so the
 * email commits or rolls back with it (the outbox, {@code registration-and-email.md}).
 *
 * <p>Deliberately small: no device, no IP, no link to the change itself. What happened, when, and
 * what to do if it wasn't them. A security email that carries a sign-in link is the shape phishing
 * copies, so the only action is the ordinary app link and the advice to reset the password.
 *
 * @param providerName     "Apple" / "Google" for the sign-in kinds, null for the password kinds.
 * @param occurredAtMillis epoch millis. Not an {@code Instant}: the outbox stores events through a
 *                         plain ObjectMapper with no java.time module.
 * @param stillHasWayIn    for {@link Kind#SIGN_IN_TURNED_OFF_AT_APPLE} only: false when Apple was the
 *                         last way in, so the email says how to get back (a password reset).
 */
public record SecurityNoticeEvent(
        String email,
        Kind kind,
        String providerName,
        long occurredAtMillis,
        boolean stillHasWayIn) {

    public enum Kind {
        /** Changed from Profile, proving the current one. Every other device was signed out. */
        PASSWORD_CHANGED,
        /** A first password on an Apple / Google login. Every other device was signed out. */
        PASSWORD_ADDED,
        /** Apple or Google can now sign in to this login. */
        SIGN_IN_CONNECTED,
        /** Removed from Profile. Every other device was signed out. */
        SIGN_IN_DISCONNECTED,
        /** Removed from Apple's side (Apple ID settings, or the Apple ID deleted). */
        SIGN_IN_TURNED_OFF_AT_APPLE
    }

    public static SecurityNoticeEvent of(String email, Kind kind, String providerName, java.time.Instant at) {
        return new SecurityNoticeEvent(email, kind, providerName, at.toEpochMilli(), true);
    }
}
