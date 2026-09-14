package com.worktrac.backend.billing;

/**
 * A household reached Plus for the first time ever, via Stripe. Published from
 * {@code SubscriptionService.applyStripeState} at most once per account, guarded by
 * {@code Subscription.plusWelcomeSentAt} -- unlike {@link AccountPlanChangedEvent}, which is
 * deliberately published on every apply, this one carries the real before/after comparison that
 * event's own javadoc explains why it avoids. Getting THIS comparison wrong fails the same way
 * (silently), but the cost of that is a missed or duplicated welcome email rather than a stale
 * permission cache, so it is worth the extra column that makes the guard exact rather than
 * best-effort.
 *
 * <p>Deliberately NOT published for a comp grant ({@code CompBootstrap}). A comped household did
 * not upgrade -- they were never charged -- and the welcome copy says "thanks for keeping Huddle
 * going" in a context that presumes a purchase just happened.
 *
 * <p>⚠️ <b>It carries the PLAN, and the plan rides on the event rather than being looked up in the
 * listener</b> -- the same call {@code MembershipInviteIssuedEvent} makes about the account noun,
 * and for the same reason: by the time an {@code AFTER_COMMIT} listener runs, the transaction that
 * knew the tier has committed and gone. Without it the listener could only send one email for every
 * paid tier, and it did: a trainer who paid for Pro received "Welcome to Huddle Plus", describing
 * four things they already had and none of the four they had just bought.
 */
public record PlusUpgradedEvent(Long accountId, BillingPlan plan) {
}
