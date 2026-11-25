package com.worktrac.backend.account;

/**
 * A household was permanently deleted. One event per login that had a way into it, so each
 * becomes its own outbox row and is retried on its own (registration-and-email.md, "one outbox
 * row = one email").
 *
 * <p>⚠️ <b>A security control, not a courtesy.</b> Deletion asks for the password or a fresh Apple
 * / Google sign-in, so a deletion nobody meant is a stolen credential, and this email is how the
 * holder finds out. For everybody else in the household it is the only explanation of why the app
 * stopped letting them in. Published from inside the deletion's own transaction, so a refused or
 * rolled-back deletion sends nothing.
 *
 * @param youDeletedIt     true for the login that deleted it; false for every other member.
 * @param loginRemains     the login still belongs to another household, so it still signs in.
 * @param billing          what happened to the household's paid plan; only ever said to the login
 *                         that deleted it, the only one who could have been paying.
 * @param occurredAtMillis epoch millis: the outbox's ObjectMapper has no java.time module.
 */
public record AccountDeletedEvent(
        String email,
        String accountName,
        long occurredAtMillis,
        boolean youDeletedIt,
        boolean loginRemains,
        Billing billing) {

    public enum Billing {
        /** No paid plan, or the email is to somebody other than the payer. */
        NONE,
        /** Paid on the web (Stripe): cancelled after the deletion commits. */
        WEB_CANCELLED,
        /** Paid through the App Store: only the subscriber can cancel it, and it is still billing. */
        STORE_STILL_BILLING
    }
}
