package com.worktrac.backend.membership;

/**
 * Published after an invite row is committed, so the email goes out off the request thread.
 *
 * <p>Same shape and the same reason as {@code VerificationCodeIssuedEvent}: sending inside the
 * transaction let a slow or failing Azure Communication Services call roll back an otherwise
 * successful write. {@code AFTER_COMMIT} means the invitation exists before anyone is told about
 * it, which is the only ordering that cannot produce a link pointing at nothing.
 *
 * <p>⚠️ Carries the RAW token — the only place it exists outside the one response that returns it.
 * The database holds a BCrypt hash and cannot reproduce this, so if the send fails, the invitation
 * is unusable and must be re-issued rather than re-sent. That is why a failure records
 * {@code MEMBER_INVITE_EMAIL_FAILED} instead of being logged and forgotten.
 *
 * <p>{@code recipientHasAccount} chooses which instruction the email gives. It exists ONLY for
 * that: it must never reach a response the owner can read, or the indistinguishability the whole
 * invite design rests on is gone.
 */
public record MembershipInviteIssuedEvent(
        String email,
        String personName,
        String householdName,
        String ownerName,
        String rawToken,
        Long inviteId,
        boolean recipientHasAccount) {
}
