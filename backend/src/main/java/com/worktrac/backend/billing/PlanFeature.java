package com.worktrac.backend.billing;

// What a PLAN includes. The tier-level mirror of membership/Permission, and it answers a different
// question from one: Permission asks "may this LOGIN do it", PlanFeature asks "does this HOUSEHOLD
// pay for it". Both must be true for anything gated by both.
//
// ⚠️ CALL SITES ASK FOR A FEATURE, NEVER FOR A TIER. There is exactly one place in the codebase
// that compares against a BillingPlan value -- BillingPlan.features() -- and adding a second is the
// bug, for exactly the reason a second `role == OWNER` comparison is (see AccountRole's header).
// `isPlus` used to be that comparison in boolean form, asked at eleven call sites; with a third
// tier on the roadmap each of those was a place the answer could drift.
//
// ⚠️ Note DATA_IMPORT sits beside membership/Permission.IMPORT_DATA and they are NOT the same
// thing. The permission says an owner may import and a member may not; the feature says the
// household's plan includes importing at all. ImportController checks both, and deliberately
// spells them differently so a reader cannot mistake one for the other.
public enum PlanFeature {

    /** History, PRs and Trends cover everything, rather than SubscriptionService.FREE_HISTORY_WINDOW. */
    FULL_HISTORY,

    /** Bringing past workouts in from a spreadsheet or another app. Export is free on every plan. */
    DATA_IMPORT,

    /** A personal login for anyone in the household. Without it a MEMBER is PAUSED_PLAN. */
    MEMBER_LOGINS
}
