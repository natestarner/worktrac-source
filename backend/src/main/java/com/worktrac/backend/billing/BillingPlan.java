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
    PLUS,

    /**
     * Personal trainers: individual client logins, each client's data private by default.
     *
     * <p>Priced by client count ({@link ClientBand}) rather than per household, which is the first
     * time a tier has a size. Everything Plus includes, Pro includes.
     */
    PRO;

    private static final Set<PlanFeature> NOTHING_EXTRA = Collections.unmodifiableSet(
            EnumSet.noneOf(PlanFeature.class));

    private static final Set<PlanFeature> PLUS_FEATURES = Collections.unmodifiableSet(EnumSet.of(
            PlanFeature.FULL_HISTORY,
            PlanFeature.DATA_IMPORT,
            PlanFeature.MEMBER_LOGINS));

    // ⚠️ Everything PLUS has, plus whatever is Pro-specific. Built FROM Plus's set rather than
    // retyped, so a feature added to Plus cannot be silently missing from the tier above it --
    // which would present as a household paying more and getting less.
    //
    // The two Pro-specific ones are what make it a trainer product rather than a bigger Plus:
    // clients who cannot see each other, and an assistant who can see all of them. The roster and
    // programs are added by the phases that ENFORCE them -- a PlanFeature nothing checks is a gate
    // nobody can fail, so declaring one early is capability on paper only.
    private static final Set<PlanFeature> PRO_FEATURES = proFeatures();

    private static Set<PlanFeature> proFeatures() {
        EnumSet<PlanFeature> features = EnumSet.copyOf(PLUS_FEATURES);
        features.add(PlanFeature.PRIVATE_MEMBERS);
        features.add(PlanFeature.MANAGER_ROLE);
        features.add(PlanFeature.ROSTER);
        features.add(PlanFeature.CHECK_INS);
        return Collections.unmodifiableSet(features);
    }

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
        return switch (this) {
            case FREE -> NOTHING_EXTRA;
            case PLUS -> PLUS_FEATURES;
            case PRO -> PRO_FEATURES;
        };
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
