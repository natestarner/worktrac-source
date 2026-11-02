package com.worktrac.backend.billing;

import com.worktrac.backend.outbox.Outbox;
import com.worktrac.backend.outbox.OutboxHandler;
import com.worktrac.backend.outbox.OutboxHandlerProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;

// Cancels a household's Stripe subscription when the household is deleted, so an erased account
// stops being charged. Its own small component rather than a method on AccountDeletionService,
// because that class is deliberately free of any knowledge of billing beyond "clear these rows".
//
// SPLIT IN TWO ON PURPOSE, and the split is what makes the ordering safe:
//
//   pendingCancellation(accountId) reads the subscription id while the row still exists.
//   scheduleCancellation(accountId, id) writes an outbox row (outbox.Outbox) INSIDE the delete
//   transaction; the Stripe call happens only after that transaction has committed.
//
// It used to be one method called BEFORE the deletes. That was wrong in a way only the failure
// path revealed: cancelling Stripe is an external side effect that cannot roll back, so any
// failure in the deletion transaction left the household with their subscription cancelled and
// their account fully intact -- they lost the Plus they were paying for and kept the data they
// asked to erase. Running after commit means the money is only ever stopped for an account that
// actually went away.
//
// It used to be an in-memory afterCommit hook. That held the only record of "this subscription
// still needs cancelling" in the JVM, so a replica that died at the wrong moment left a deleted
// household being charged with nothing anywhere saying so. As an outbox row it commits with the
// delete, survives any replica, and is retried with backoff before it is reported as failed.
//
// BEST EFFORT, ON PURPOSE. Every failure here is swallowed after being recorded, and that is the
// deliberate trade rather than an oversight:
//
//   Deleting your account is a right, not a convenience. If a Stripe outage could make the delete
//   throw, an unreachable third party would be standing between someone and the erasure of their
//   own data -- and the delete is already irreversible by the time it matters. Running after
//   commit preserves this: by the time this executes, the deletion has already succeeded and
//   nothing here can undo it.
//
//   The cost of giving up is a subscription that keeps billing a deleted account. That is real
//   money, so it is NOT silent: when the outbox's last retry fails, a BillingEvent names the Stripe
//   subscription id, which is exactly what someone needs to cancel it by hand in the Dashboard. "It failed and
//   nobody knows" is the outcome this codebase forbids; "it failed and there is a row saying so"
//   is an operational task.
//
// ⚠️ That audit row only survives BECAUSE this runs after commit. AccountDeletionService clears
// billing_events as part of the delete, so an event written before that ran was deleted moments
// later by the very transaction it was recording the failure of -- the safety net destroyed
// itself, and the invariant above was not actually true. Do not move this back in front of the
// deletes.
@Component
public class StripeSubscriptionCanceller implements OutboxHandlerProvider {

    private static final Logger log = LoggerFactory.getLogger(StripeSubscriptionCanceller.class);

    static final String CANCEL_ON_ACCOUNT_DELETION = "stripe.cancel-on-account-deletion";

    record Cancellation(Long accountId, String stripeSubscriptionId) {
    }

    private final SubscriptionRepository subscriptionRepository;
    private final StripeService stripeService;
    private final BillingAuditService auditService;
    private final Outbox outbox;

    public StripeSubscriptionCanceller(SubscriptionRepository subscriptionRepository,
                                        StripeService stripeService, BillingAuditService auditService,
                                        Outbox outbox) {
        this.subscriptionRepository = subscriptionRepository;
        this.stripeService = stripeService;
        this.auditService = auditService;
        this.outbox = outbox;
    }

    // The subscription id that will need cancelling once the deletion commits, or null if there is
    // nothing to cancel (no Stripe configured, no subscription, or a household that never paid).
    // MUST be called while the subscriptions row still exists.
    public String pendingCancellation(Long accountId) {
        if (!stripeService.isConfigured()) {
            return null;
        }
        return subscriptionRepository.findByAccountId(accountId)
                .map(Subscription::getStripeSubscriptionId)
                .filter(id -> !id.isBlank())
                .orElse(null);
    }

    // Null id => nothing to do, so callers need no branch of their own.
    /**
     * Records that this subscription must be cancelled once the caller's transaction commits. Call
     * it INSIDE the delete transaction, after the deletes: the row then commits or rolls back with
     * them.
     */
    public void scheduleCancellation(Long accountId, String stripeSubscriptionId) {
        if (stripeSubscriptionId == null || stripeSubscriptionId.isBlank()) {
            return;
        }
        outbox.enqueue(CANCEL_ON_ACCOUNT_DELETION, new Cancellation(accountId, stripeSubscriptionId));
    }

    @Override
    public List<OutboxHandler<?>> outboxHandlers() {
        return List.of(new OutboxHandler<>(CANCEL_ON_ACCOUNT_DELETION, Cancellation.class,
                cancellation -> {
                    // A StripeException propagates, so the outbox retries it.
                    stripeService.cancelSubscription(cancellation.stripeSubscriptionId());
                    auditService.record(cancellation.accountId(), BillingEventType.CANCELED_ON_ACCOUNT_DELETION,
                            "Cancelled " + cancellation.stripeSubscriptionId() + " because the household was deleted");
                },
                (cancellation, reason) -> {
                    // The subscription id is in the detail deliberately: the account row is gone by
                    // now, so this event is the ONLY remaining record of what needs cancelling by hand.
                    auditService.record(cancellation.accountId(), BillingEventType.CANCELED_ON_ACCOUNT_DELETION,
                            "FAILED to cancel " + cancellation.stripeSubscriptionId() + " on account deletion -- cancel it"
                                    + " manually in the Stripe Dashboard. Reason: " + reason);
                    log.error("Could not cancel Stripe subscription {} while deleting account {}: {}",
                            cancellation.stripeSubscriptionId(), cancellation.accountId(), reason);
                }));
    }
}
