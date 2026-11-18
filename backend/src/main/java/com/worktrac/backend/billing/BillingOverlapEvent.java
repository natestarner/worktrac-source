package com.worktrac.backend.billing;

import com.worktrac.backend.billing.store.StoreEnvironment;

/**
 * Two sources were found paying for one household (docs/in-app-purchase-plan.md, rule 5). Published
 * by SubscriptionService inside the write's transaction; {@link BillingOverlapHandler} turns it into
 * outbox work, so the cancel, the refund and the owner's email happen after commit and survive a
 * replica dying.
 *
 * @param loser            the subscription to cancel and refund; for an uncancellable overlap, the
 *                         one the owner is asked to cancel in Settings
 * @param loserEnvironment the store environment of the loser, when it is a store (null for Stripe)
 * @param keeper           the source that keeps billing the household
 * @param uncancellable    true when neither could be cancelled by us: nothing is cancelled, people
 *                         are told instead
 */
public record BillingOverlapEvent(
        Long accountId,
        BillingSource loser,
        String loserSubscriptionId,
        StoreEnvironment loserEnvironment,
        BillingSource keeper,
        String keeperSubscriptionId,
        boolean uncancellable) {

    public static BillingOverlapEvent refund(Long accountId, BillingSource loser, String loserSubscriptionId,
                                             StoreEnvironment loserEnvironment, BillingSource keeper) {
        return new BillingOverlapEvent(accountId, loser, loserSubscriptionId, loserEnvironment, keeper,
                null, false);
    }

    public static BillingOverlapEvent uncancellable(Long accountId, BillingSource keeper, String keeperSubscriptionId,
                                                    BillingSource other, String otherSubscriptionId) {
        return new BillingOverlapEvent(accountId, other, otherSubscriptionId, null, keeper,
                keeperSubscriptionId, true);
    }
}
