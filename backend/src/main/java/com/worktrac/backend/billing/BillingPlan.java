package com.worktrac.backend.billing;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

// What a household is entitled to. This is the DERIVED answer that SubscriptionService.entitledPlan
// produces and AccountDto carries to the client, not a mirror of Stripe's subscription status (that
// is SubscriptionStatus). Keeping the two types separate is what stops the UI branching on Stripe
// vocabulary -- a screen should ask "what does this household's plan include", never "is this
// household past_due".
//
// ⚠️ THE MAP BELOW IS THE ONLY PLACE IN THE CODEBASE THAT BRANCHES ON A TIER. Everything else asks
// for a PlanFeature. Keep it that way -- it is the entire reason adding the planned Pro (personal
// trainers) and Team (clubs) tiers is a change here rather than a change at every gate. See the
// tier roadmap in .claude/rules/billing.md.
public enum BillingPlan {

    /** Free forever, not a trial. Everything except the features below. */
    FREE,

    /** The paid family tier. Named Pro until #280 renamed it to free that word for the Pro tier. */
    PLUS;

    private static final Set<PlanFeature> NOTHING_EXTRA = Collections.unmodifiableSet(
            EnumSet.noneOf(PlanFeature.class));

    private static final Set<PlanFeature> PLUS_FEATURES = Collections.unmodifiableSet(EnumSet.of(
            PlanFeature.FULL_HISTORY,
            PlanFeature.DATA_IMPORT,
            PlanFeature.MEMBER_LOGINS));

    /**
     * What this plan includes.
     *
     * <p>⚠️ FREE is deliberately an EMPTY set rather than a subset of PLUS. Everything Free gets --
     * unlimited workouts, every person in the household, offline logging, PRs, routines, and the
     * full data export -- is ungated, so it is not a "feature" in this enum's sense at all. Listing
     * those here would invite gating one of them later, and the marketing site promises several of
     * them in writing on both plans.
     */
    public Set<PlanFeature> features() {
        return this == PLUS ? PLUS_FEATURES : NOTHING_EXTRA;
    }

    /** Whether this plan is paid for. Used for wording and chrome, never as a gate -- gates ask has(). */
    public boolean isPaid() {
        return this != FREE;
    }

    /** Whether this plan includes the given feature. */
    public boolean has(PlanFeature feature) {
        return features().contains(feature);
    }
}
