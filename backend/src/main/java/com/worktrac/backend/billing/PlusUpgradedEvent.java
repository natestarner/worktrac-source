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
 */
public record PlusUpgradedEvent(Long accountId) {
}
