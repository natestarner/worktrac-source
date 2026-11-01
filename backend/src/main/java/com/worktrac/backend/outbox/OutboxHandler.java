package com.worktrac.backend.outbox;

/**
 * One kind of outbox work: how to deliver a row's payload, and what to record when it finally
 * cannot be. Declared by the component that owns the work (see {@link OutboxHandlerProvider}) and
 * referred to on the row by {@link #name()}.
 *
 * <p>⚠️ {@link #name()} is stored in the database. Renaming a handler strands any of its rows still
 * PENDING at deploy time — the dispatcher marks them FAILED as unknown. Add a new name instead, and
 * keep the old one until its rows have drained.
 *
 * <p>⚠️ <b>One row is one external side effect.</b> A row is retried as a whole, so a handler that
 * sent two emails would resend the first whenever the second failed. Two emails are two rows
 * ({@code MembershipAcceptedEvent} enqueues two).
 *
 * @param name        stable identifier stored on the row, e.g. {@code "email.verification-code"}
 * @param payloadType the payload's class; it is stored as JSON
 * @param delivery    performs the side effect and records success. Throwing means "try again"
 * @param giveUp      called once, after the final attempt failed, with the last failure's reason
 */
public record OutboxHandler<P>(String name, Class<P> payloadType, Delivery<P> delivery, GiveUp<P> giveUp) {

    @FunctionalInterface
    public interface Delivery<P> {
        void deliver(P payload) throws Exception;
    }

    @FunctionalInterface
    public interface GiveUp<P> {
        void giveUp(P payload, String reason);
    }
}
