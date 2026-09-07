package com.worktrac.backend.membership;

/**
 * The client's view of {@link AccountAccess}: who this login is inside this household, and what
 * that lets them see.
 *
 * <p>One object rather than three loose fields on two responses, because the client has one
 * question — "what may I do here?" — and answering it from scattered flags is how a screen ends up
 * disagreeing with another screen.
 *
 * <p><b>This drives chrome only.</b> The server has already decided; every list is filtered and
 * every write is guarded before anything here is sent. What it buys is a client that doesn't offer
 * a control it knows will be refused — the same relationship {@code AccountDto.plan} has with
 * {@code SubscriptionService.isPro}, and it carries the same warning: never treat it as the
 * authority, and never re-derive a permission from it that the server didn't state.
 *
 * <p><b>{@code ownerName} answers "who do I ask?"</b> — the household owner's person name, or null
 * when the account has no owner membership to read one from. It is the one piece of information a
 * member needs that is about somebody else, and it is deliberately a NAME and nothing more: no
 * email, no id, nothing that would let a member contact or act on the owner outside the app. It
 * also carries the copy weight in the refusals a member can hit — "ask Nate to rename it" is only
 * actionable because this field exists.
 *
 * <p><b>{@code status} is the ONE field here that is not merely chrome.</b> Everything else on
 * this object stops the client offering a control the server would refuse; {@code PAUSED_PLAN}
 * makes the client render a different screen entirely. That is deliberate: a paused login must
 * learn it is paused from {@code /me} answering 200, not by inferring it from a 403 on some other
 * request. The client cannot tell a refusal from a struggling backend by status alone, and
 * guessing wrong there is the signed-out failure
 * {@code docs/incidents/2026-07-27-db-outage-forced-logout.md} describes.
 *
 * <p>Deliberately carries no permission list. The client needs "can I write to this person" and
 * "who can I see", both derivable from these three fields; shipping the full enum would put a
 * server-side vocabulary into every persisted auth snapshot, where it would then have to be
 * version-migrated every time the enum changed.
 */
public record MembershipDto(String accountRole, Long personId, boolean membersSeeEveryone,
                             String ownerName, String status) {

    public static MembershipDto from(AccountAccess access, String ownerName) {
        return new MembershipDto(access.accountRole().name(), access.selfPersonId(),
                access.membersSeeEveryone(), ownerName, access.status().name());
    }

    /**
     * The login-time variant, where no {@link AccountAccess} has been resolved yet.
     *
     * <p>{@code accountIsPro} is passed in rather than read off the membership because entitlement
     * is not a column — it is derived from the subscription's state, including a time-dependent
     * branch. Passing it keeps {@code SubscriptionService.isPro} the single authority instead of
     * this DTO growing a second opinion about what Pro means.
     */
    public static MembershipDto from(AccountMembership membership, String ownerName,
                                      boolean accountIsPro) {
        return new MembershipDto(
                membership.getAccountRole().name(),
                membership.getPerson() == null ? null : membership.getPerson().getId(),
                membership.getAccount().isMembersSeeEveryone(),
                ownerName,
                MembershipStatus.forRole(membership.getAccountRole(), accountIsPro).name());
    }
}
