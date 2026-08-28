package com.worktrac.backend.support;

import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionStatus;

// Puts a test household on Pro without going anywhere near Stripe.
//
// Exists because the Free-tier gates made explicit an assumption most existing tests were making
// silently: they seed months of history, or import a file, and were written when every household
// could do both. Those tests are about history, trends and importing -- not about billing -- so
// the honest fix is to say "this household is Pro" out loud rather than to weaken the gate they
// now trip over.
//
// Writes the row directly on purpose. Going through checkout would drag Stripe into thirty tests
// that have nothing to do with payments, and StripeService is precisely the seam that exists so it
// does not have to be.
public final class BillingTestSupport {

    private BillingTestSupport() {
    }

    public static void makePro(SubscriptionRepository subscriptionRepository, Long accountId) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow(
                () -> new IllegalStateException("No subscription row for account " + accountId
                        + " -- registration should have created one"));
        subscription.setStatus(SubscriptionStatus.ACTIVE);
        subscription.setPlan(BillingPlan.PRO);
        subscriptionRepository.save(subscription);
    }
}
