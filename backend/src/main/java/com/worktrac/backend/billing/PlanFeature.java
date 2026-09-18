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
    MEMBER_LOGINS,

    /**
     * The account may decide whether its members see each other, rather than always seeing
     * everyone.
     *
     * <p>This is what makes {@code accounts.members_see_everyone} settable. Without it the column
     * is forced ON — which is right for a family, where everyone expects to see everyone, and wrong
     * for a trainer whose clients must not see each other's numbers.
     *
     * <p>⚠️ It gates the SETTING, not the reading. Every account still HAS the column and every
     * guard still honours it; a plan without this feature simply cannot change it away from the
     * family default. That is deliberate: dropping the tier must not silently expose one client's
     * training to another, so the value is left exactly as it was (see AccountService).
     */
    PRIVATE_MEMBERS,

    /**
     * The account may hand out a MANAGER login — full reach over everyone, no say over the account.
     *
     * <p>Separate from MEMBER_LOGINS because they are different products: a family buying personal
     * logins is not thereby buying an assistant, and an assistant is the thing a practice with more
     * than one trainer actually needs.
     */
    MANAGER_ROLE,

    /**
     * The trainer roster — everyone on the account, ordered by who has gone quietest.
     *
     * <p>⚠️ CHROME ONLY, and the one feature in this enum the SERVER never refuses on. Every number
     * on the roster is derived from workouts the caller can already read one person at a time, so
     * refusing the aggregate would protect nothing — it would decline a convenience while leaving
     * the information reachable. {@code GET /api/account/roster} is therefore gated on
     * {@code VIEW_OTHER_PEOPLE} alone.
     *
     * <p>What this grants is the ENTRY POINT. A roster of four people who live in the same house,
     * sorted by who trained least recently, is not a useful screen; a roster of forty clients is
     * the whole product. That is a discovery decision, not an access one.
     */
    ROSTER,

    /**
     * Check-ins -- a dated entry (weight, a note) about a person, recorded by themselves or by
     * whoever trains them.
     *
     * <p>⚠️ CHROME ONLY, the same shape as {@link #ROSTER}: {@code CheckInController} carries no
     * plan check at all, and a family recording their own bodyweight is harmless. What this gates
     * is the account-menu ENTRY POINT -- a family already has a person switcher and a profile for
     * that; a coaching relationship is what makes "Check-ins" a feature worth a menu item of its
     * own rather than noise beside Profile.
     */
    CHECK_INS
}
