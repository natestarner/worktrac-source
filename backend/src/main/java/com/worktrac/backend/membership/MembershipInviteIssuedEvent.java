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
        String accountName,
        // What this account CALLS itself -- "household" on a family plan, "practice" on a trainer's
        // (AccountVocab). The invitation says "{owner} owns this {noun}", and a client being told
        // they have joined somebody's "household" is being told something false about a
        // relationship they are paying for. Carried on the event rather than resolved in the
        // listener, because by then the transaction that knew the tier has committed and gone.
        String accountNoun,
        String ownerName,
        String rawToken,
        Long inviteId,
        boolean recipientHasAccount) {
}
