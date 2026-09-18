package com.worktrac.backend.billing;

import java.time.Instant;

// What the billing screen reads. Carries both the derived entitlement (`plan`) and the raw Stripe
// status, because the screen legitimately needs both: `plan` decides what the household can do,
// `status` decides what to SAY about it -- "renews", "ends", or "we could not take your payment".
//
// ⚠️ There was once a second field, `boolean pro`, carrying the same answer as `plan` in a
// different shape -- so the client read `plan === 'PLUS' || subscription.pro === true`, an OR
// across two spellings of one fact. It is gone. One derivation reaches the browser, and adding a
// per-tier boolean beside `plan` is the bug: with four tiers that is one new field per tier, each
// free to disagree with the enum it was derived from.
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
        // How many clients the plan covers, for the billing screen's "12 of 15 clients" line. Null
        // for every household tier and for an unlimited band -- the screen renders those two
        // differently from each other and from a number, so a sentinel would not help.
        Integer clientSeats,
        // How many clients are actually on the roster right now -- the "12" in "12 of 15". Null for
        // every household tier, same as clientSeats: they have no seats to count usage against.
        Integer clientCount) {

    public static SubscriptionDto from(Subscription subscription, BillingPlan entitledPlan, Integer clientCount) {
        return new SubscriptionDto(
                entitledPlan,
                subscription.getStatus(),
                subscription.getBillingInterval(),
                subscription.getCurrentPeriodEnd(),
                subscription.isCancelAtPeriodEnd(),
                subscription.isComped(),
                // Only while the tier is actually in force. A lapsed Pro row still records the band
                // it bought, and reporting those seats would tell a Free account it has a roster
                // allowance it is not paying for.
                entitledPlan == BillingPlan.FREE ? null : subscription.getClientSeats(),
                entitledPlan == BillingPlan.FREE ? null : clientCount);
    }

    // A household with no subscription row. Should be unreachable (registration creates one and
    // V56 backfilled the rest), but a billing screen that 500s because billing has no opinion yet
    // is strictly worse than one that correctly says "Free".
    public static SubscriptionDto free() {
        return new SubscriptionDto(BillingPlan.FREE, SubscriptionStatus.FREE, null, null, false, false, null, null);
    }
}
