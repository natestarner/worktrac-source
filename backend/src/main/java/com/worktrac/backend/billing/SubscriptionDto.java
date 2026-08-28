package com.worktrac.backend.billing;

import java.time.Instant;

// What the billing screen reads. Carries both the derived answer (`pro`) and the raw Stripe status,
// because the screen legitimately needs both: `pro` decides what the household can do, `status`
// decides what to SAY about it -- "renews", "ends", or "we could not take your payment".
//
// Deliberately carries no Stripe customer or subscription id. Those are support identifiers with no
// use in the browser, and the admin list is where they belong.
public record SubscriptionDto(
        BillingPlan plan,
        SubscriptionStatus status,
        BillingInterval billingInterval,
        Instant currentPeriodEnd,
        boolean cancelAtPeriodEnd,
        boolean comped,
        boolean pro) {

    public static SubscriptionDto from(Subscription subscription, boolean pro) {
        return new SubscriptionDto(
                pro ? BillingPlan.PRO : BillingPlan.FREE,
                subscription.getStatus(),
                subscription.getBillingInterval(),
                subscription.getCurrentPeriodEnd(),
                subscription.isCancelAtPeriodEnd(),
                subscription.isComped(),
                pro);
    }

    // A household with no subscription row. Should be unreachable (registration creates one and
    // V56 backfilled the rest), but a billing screen that 500s because billing has no opinion yet
    // is strictly worse than one that correctly says "Free".
    public static SubscriptionDto free() {
        return new SubscriptionDto(BillingPlan.FREE, SubscriptionStatus.FREE, null, null, false, false, false);
    }
}
