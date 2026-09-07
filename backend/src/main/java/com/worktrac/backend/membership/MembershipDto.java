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
 * <p>Deliberately carries no permission list. The client needs "can I write to this person" and
 * "who can I see", both derivable from these three fields; shipping the full enum would put a
 * server-side vocabulary into every persisted auth snapshot, where it would then have to be
 * version-migrated every time the enum changed.
 */
public record MembershipDto(String accountRole, Long personId, boolean membersSeeEveryone) {

    public static MembershipDto from(AccountAccess access) {
        return new MembershipDto(access.accountRole().name(), access.selfPersonId(),
                access.membersSeeEveryone());
    }

    public static MembershipDto from(AccountMembership membership) {
        return new MembershipDto(
                membership.getAccountRole().name(),
                membership.getPerson() == null ? null : membership.getPerson().getId(),
                membership.getAccount().isMembersSeeEveryone());
    }
}
