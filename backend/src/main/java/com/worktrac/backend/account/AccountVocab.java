package com.worktrac.backend.account;

import com.worktrac.backend.billing.BillingPlan;

/**
 * The user-facing NOUNS for one account, derived from its tier.
 *
 * <p>The app's vocabulary is family-shaped because the app was: a household, with family members in
 * it. On a trainer's account every one of those words is wrong — a client is not a family member,
 * and being told "the owner of this household can see your workouts" is a worse sentence for a
 * paying client than it is for a teenager.
 *
 * <p>⚠️ THIS IS PRESENTATION, NOT AUTHORITY. Nothing here decides what anyone may do. Roles answer
 * that ({@code AccountRole.permissions}) and tiers answer capability ({@code BillingPlan.features}),
 * and adding a third thing that looks plan-shaped is exactly the confusion those two files exist to
 * prevent. If a change here would alter what someone can DO, it belongs in one of those instead.
 *
 * <p>Derived on the SERVER and carried on {@link AccountDto} rather than computed in the client, for
 * three reasons: it survives a cold offline boot inside the auth snapshot, the email templates can
 * share the same map, and there is one place to change when Team lands rather than one per surface.
 *
 * <p><b>Absence is the safe default.</b> A client reading an auth snapshot written before this field
 * existed sees no vocab at all and falls back to the family nouns — which is correct for every
 * account that has one, and for the overwhelming majority of accounts generally. Same posture as
 * {@code PlanBadge} on an unknown plan. See {@code frontend/src/utils/accountVocab.js}.
 */
public record AccountVocab(String account, String owner, String member, String manager) {

    // ⚠️ `owner` is allowed to be two words ("household owner") while the others are one. It is a
    // NOUN PHRASE for a person, not a modifier: call sites capitalise it and use it whole, so
    // "Trainer" and "Household owner" both read correctly as a field label. Do not "normalise" it
    // to one word -- "Household" alone would name the account, not the person running it.
    private static final AccountVocab FAMILY =
            new AccountVocab("household", "household owner", "family member", "co-parent");
    private static final AccountVocab PRACTICE =
            new AccountVocab("practice", "trainer", "client", "assistant");

    /**
     * The nouns for a tier.
     *
     * <p>⚠️ Deliberately an exhaustive switch with NO default. When {@code BillingPlan.TEAM} is
     * added this file stops compiling until somebody decides what a Team account calls its people —
     * which is the point. A default would silently hand a sports team the word "household", and the
     * failure would surface as a screenshot in a bug report rather than at build time.
     *
     * <p>Team's row is already decided ("team" / "coach" / "athlete" / "assistant coach"); it is
     * written down in {@code .claude/rules/coaching.md} rather than here, because a constant no
     * code path can reach is a different kind of debt. Note that Team's OWNER is the one called
     * "coach" — which is precisely why the assistant role is {@code MANAGER} and not {@code COACH}.
     */
    public static AccountVocab forPlan(BillingPlan plan) {
        return switch (plan) {
            case FREE, PLUS -> FAMILY;
            case PRO -> PRACTICE;
        };
    }
}
