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
        /**
         * Why this household was comped, in the granting admin's words. Null for a grant made
         * before the note existed (every {@code COMPED_EMAILS} one) or left blank.
         *
         * <p>Safe to surface: it is text an admin typed into the admin portal, not household data
         * and not a secret. Who granted it and when are audit facts and live in
         * {@code billing_events}, not here.
         */
        String compNote,
        /**
         * Would {@code POST /accounts/{id}/comp} succeed for this household right now?
         *
         * <p>The server's own precomputed answer, so the client never re-derives the rule -- the
         * same contract {@code TagDto.deletable} and {@code ExerciseDto.renamable} have, and the
         * reason the Accounts tab can hide a control the server would refuse rather than turning a
         * 409 into a toast ({@code .claude/rules/member-access.md}).
         *
         * <p>False means a live Stripe subscription is paying for this household, so comping it
         * would leave them charged for a plan they were just given. Shared with
         * {@code CompGrantService.blockedByStripe} rather than mirrored -- one definition, two
         * readers.
         */
        boolean compGrantable,
        /**
         * The client ceiling this subscription is licensed for, or null for a household tier and
         * for Pro's unlimited band.
         *
         * <p>Carried so the grant form can preselect the band a Pro household ACTUALLY has. Without
         * it the form opened on Starter for every comped Pro household, and pressing "Update grant"
         * to change only the note would silently rewrite a Practice band down to Starter. A band is
         * a ceiling on adding rather than a revocation, so nothing would have broken for their
         * existing clients — it would simply have refused the next one, for no reason anybody could
         * have traced back to this screen.
         */
        Integer clientSeats,
        String stripeCustomerId) {
}
