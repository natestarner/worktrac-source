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
// household showing PLUS/PAST_DUE is mid-dunning and still entitled -- collapsing the two would hide
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
        /**
         * How many logins this household has — {@code account_memberships} rows, so the owner's own
         * counts as one.
         *
         * <p>The number the admin actually needs is "does this household use member logins", and
         * the honest form of that is a raw count rather than a boolean: a household of 5 people
         * with 1 login and one with 4 are very different support conversations, and a flag would
         * flatten them. It is also the number that makes the Team-tier question answerable — how
         * many households have outgrown the family shape — without a second query per row.
         */
        long loginCount,
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
