package com.worktrac.backend.billing;

/**
 * A household's entitlement may have changed — published from the one place that applies plan
 * state, {@code SubscriptionService.applyStripeState}.
 *
 * <p>"May have": it is published on every apply rather than only on a real transition, because
 * working out whether entitlement actually flipped means comparing {@code isPlus} before and after,
 * and getting that comparison subtly wrong fails SILENTLY — the cache simply keeps answering the
 * old value until it expires. Publishing unconditionally makes the failure mode "invalidated a
 * cache entry we did not need to", which costs one database read.
 *
 * <p>An event rather than a direct call because the dependency runs the wrong way otherwise:
 * {@code AccountAccessService} already depends on {@code SubscriptionService} to resolve the plan,
 * so billing calling back into membership would be a cycle Spring refuses to construct.
 */
public record AccountPlanChangedEvent(Long accountId) {
}
