package com.worktrac.backend.billing;

import com.stripe.exception.StripeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

// Cancels a household's Stripe subscription when the household is deleted, so an erased account
// stops being charged. Its own small component rather than a method on AccountDeletionService,
// because that class is deliberately free of any knowledge of billing beyond "clear these rows".
//
// BEST EFFORT, ON PURPOSE. Every failure here is swallowed after being recorded, and that is the
// deliberate trade rather than an oversight:
//
//   Deleting your account is a right, not a convenience. If a Stripe outage could make the delete
//   throw, an unreachable third party would be standing between someone and the erasure of their
//   own data -- and the delete is already irreversible by the time it matters. Failing the whole
//   operation would also leave the household's workout data intact but their intent ignored, which
//   is the worse of the two outcomes.
//
//   The cost of swallowing is a subscription that keeps billing a deleted account. That is real
//   money, so it is NOT silent: every failure writes a BillingEvent naming the Stripe subscription
//   id, which is exactly what someone needs to cancel it by hand in the Dashboard. "It failed and
//   nobody knows" is the outcome this codebase forbids; "it failed and there is a row saying so"
//   is an operational task.
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

    public void cancelForAccount(Long accountId) {
        if (!stripeService.isConfigured()) {
            return;
        }
        subscriptionRepository.findByAccountId(accountId)
                .map(Subscription::getStripeSubscriptionId)
                .filter(id -> id != null && !id.isBlank())
                .ifPresent(stripeSubscriptionId -> cancel(accountId, stripeSubscriptionId));
    }

    private void cancel(Long accountId, String stripeSubscriptionId) {
        try {
            stripeService.cancelSubscription(stripeSubscriptionId);
            auditService.record(accountId, BillingEventType.CANCELED_ON_ACCOUNT_DELETION,
                    "Cancelled " + stripeSubscriptionId + " because the household was deleted");
        } catch (StripeException e) {
            // The subscription id is in the detail deliberately: the account row is about to be
            // gone, so this event is the ONLY remaining record of what needs cancelling by hand.
            auditService.record(accountId, BillingEventType.CANCELED_ON_ACCOUNT_DELETION,
                    "FAILED to cancel " + stripeSubscriptionId + " on account deletion -- cancel it"
                            + " manually in the Stripe Dashboard. Reason: " + e.getMessage());
            log.error("Could not cancel Stripe subscription {} while deleting account {}",
                    stripeSubscriptionId, accountId, e);
        }
    }
}
