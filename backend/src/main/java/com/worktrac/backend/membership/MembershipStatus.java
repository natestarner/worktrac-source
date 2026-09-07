package com.worktrac.backend.membership;

/**
 * Whether a login may currently be used in this household, as opposed to what it may do.
 *
 * <p>Deliberately separate from {@link Permission}. A permission answers "may this login do X";
 * this answers "may this login do anything at all right now". Folding a paused plan into the
 * permission map would mean every one of the sixteen permissions growing a plan clause, and the
 * one screen a paused member IS allowed to see would have to be expressed as a permission it holds
 * — which is backwards, because it is not something they earned, it is the only door left open.
 */
public enum MembershipStatus {

    /** Usable. Every owner, and every member of a Pro household. */
    ACTIVE,

    /**
     * A MEMBER login in a household that is no longer Pro.
     *
     * <p>⚠️ <b>A pause, not a punishment, and the distinction is the whole design.</b> Nothing is
     * deleted, no membership is revoked, and no queued write is discarded — the member's person,
     * history and PRs stay exactly where they are, visible to the owner as always. When the
     * household is Pro again the login resumes on its own, and any work the member had queued
     * lands by itself on the next flush.
     *
     * <p>That is why the block is expressed as a status rather than by deleting memberships on
     * downgrade: deleting would be irreversible, would need re-inviting everybody on re-upgrade,
     * and would turn a billing lapse into data loss.
     */
    PAUSED_PLAN;

    /**
     * ⚠️ <b>THE ONLY PLACE THIS IS DERIVED.</b> Two callers need it and they must never disagree:
     * {@link AccountAccess#status()} answers it per request (for {@code /me} and
     * {@code PermissionInterceptor}), and {@code MembershipDto.from(AccountMembership, ...)}
     * answers it at login, before any {@code AccountAccess} exists.
     *
     * <p>It shipped as two independent copies of the same expression. Nothing was wrong with either
     * one — that is the point: a second home for one decision costs nothing until the decision
     * changes, and then {@code /login} and {@code /me} disagree about whether somebody is paused
     * while {@code /me} is documented as the single authority. Same rule as
     * {@code AccountRole.permissions()} being the only role→authority map.
     */
    public static MembershipStatus forRole(AccountRole role, boolean accountIsPro) {
        return role == AccountRole.MEMBER && !accountIsPro ? PAUSED_PLAN : ACTIVE;
    }
}