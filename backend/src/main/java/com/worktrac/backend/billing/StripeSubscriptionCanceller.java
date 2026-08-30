package com.worktrac.backend.billing;

import com.stripe.exception.StripeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

// Cancels a household's Stripe subscription when the household is deleted, so an erased account
// stops being charged. Its own small component rather than a method on AccountDeletionService,
// because that class is deliberately free of any knowledge of billing beyond "clear these rows".
//
// SPLIT IN TWO ON PURPOSE, and the split is what makes the ordering safe:
//
//   pendingCancellation(accountId) reads the subscription id while the row still exists.
//   cancel(accountId, id) performs the Stripe call, and is invoked AFTER the delete transaction
//   has committed.
//
// It used to be one method called BEFORE the deletes. That was wrong in a way only the failure
// path revealed: cancelling Stripe is an external side effect that cannot roll back, so any
// failure in the deletion transaction left the household with their subscription cancelled and
// their account fully intact -- they lost the Pro they were paying for and kept the data they
// asked to erase. Running after commit means the money is only ever stopped for an account that
// actually went away.
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
//   The cost of swallowing is a subscription that keeps billing a deleted account. That is real
//   money, so it is NOT silent: every failure writes a BillingEvent naming the Stripe subscription
//   id, which is exactly what someone needs to cancel it by hand in the Dashboard. "It failed and
//   nobody knows" is the outcome this codebase forbids; "it failed and there is a row saying so"
//   is an operational task.
//
// ⚠️ That audit row only survives BECAUSE this runs after commit. AccountDeletionService clears
// billing_events as part of the delete, so an event written before that ran was deleted moments
// later by the very transaction it was recording the failure of -- the safety net destroyed
// itself, and the invariant above was not actually true. Do not move this back in front of the
// deletes.
@Component
public class StripeSubscriptionCanceller {

    private static final Logger log = LoggerFactory.getLogger(StripeSubscriptionCanceller.class);

    private final SubscriptionRepository subscriptionRepository;
    private final StripeService stripeService;
    private final BillingAuditService auditService;

    public StripeSubscriptionCanceller(SubscriptionRepository subscriptionRepository,
                                        StripeService stripeService, BillingAuditService auditService) {
        this.subscriptionRepository = subscriptionRepository;
        this.stripeService = stripeService;
        this.auditService = auditService;
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
    public void cancel(Long accountId, String stripeSubscriptionId) {
        if (stripeSubscriptionId == null || stripeSubscriptionId.isBlank()) {
            return;
        }
        try {
            stripeService.cancelSubscription(stripeSubscriptionId);
            auditService.record(accountId, BillingEventType.CANCELED_ON_ACCOUNT_DELETION,
                    "Cancelled " + stripeSubscriptionId + " because the household was deleted");
        } catch (StripeException e) {
            // The subscription id is in the detail deliberately: the account row is gone by now, so
            // this event is the ONLY remaining record of what needs cancelling by hand.
            auditService.record(accountId, BillingEventType.CANCELED_ON_ACCOUNT_DELETION,
                    "FAILED to cancel " + stripeSubscriptionId + " on account deletion -- cancel it"
                            + " manually in the Stripe Dashboard. Reason: " + e.getMessage());
            log.error("Could not cancel Stripe subscription {} while deleting account {}",
                    stripeSubscriptionId, accountId, e);
        }
    }
}
