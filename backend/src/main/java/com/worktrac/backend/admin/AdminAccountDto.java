package com.worktrac.backend.admin;

import com.worktrac.backend.billing.BillingInterval;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.SubscriptionStatus;

import java.time.Instant;

// `stripeCustomerId` is included deliberately. Admin DTOs must never carry a hashed or secret value
// (see .claude/rules/admin-portal.md), and a Stripe customer id is neither -- it is the support
// identifier you need to find a household in the Stripe Dashboard when they write in about a
// charge. The secret key, the webhook secret and anything card-shaped stay server-side and are
// never surfaced here.
//
// Both `plan` and `status` are exposed because they answer different questions: `plan` is the
// derived entitlement (what this household can do), `status` is Stripe's own view (why). A
// household showing PRO/PAST_DUE is mid-dunning and still entitled -- collapsing the two would hide
// exactly the state worth noticing.
public record AdminAccountDto(
        Long id,
        String name,
        String primaryPersonName,
        String userEmail,
        String role,
        String defaultUnit,
        Instant createdAt,
        long peopleCount,
        long sessionCount,
        long setCount,
        Instant lastActivityAt,
        BillingPlan plan,
        SubscriptionStatus subscriptionStatus,
        BillingInterval billingInterval,
        Instant currentPeriodEnd,
        boolean cancelAtPeriodEnd,
        boolean comped,
        String stripeCustomerId) {
}
