package com.worktrac.backend.billing;

// Our narrowed view of Stripe's subscription status. Mapped from the Stripe string at one seam
// rather than stored raw, so an unrecognized future status fails loudly in one place instead of
// spreading string comparisons through the app.
//
// Note TRIALING: this product ships with no trial (the Free tier is the trial). It is here anyway
// because enabling a trial is a Dashboard setting, not a code change -- if one is ever switched on,
// the entitlement derivation should already treat those households as Pro rather than silently
// locking out people Stripe considers in good standing.
public enum SubscriptionStatus {

    // No Stripe subscription has ever existed for this account.
    FREE,

    // Checkout was started but payment never completed. Not entitled.
    INCOMPLETE,

    // Stripe considers the subscription in good standing.
    TRIALING,
    ACTIVE,

    // Payment failed and Stripe is retrying (Smart Retries). Entitlement CONTINUES through this
    // window -- see SubscriptionService.isPro for why cutting access mid-dunning is the wrong call.
    PAST_DUE,

    // Ended, or ending. Entitlement continues until current_period_end, because they paid for it.
    CANCELED,

    // Retries were exhausted and Stripe left the subscription unpaid rather than cancelling it.
    // Reachable only if the Dashboard's end-of-retries behaviour is changed away from "cancel".
    // Not entitled.
    UNPAID
}
