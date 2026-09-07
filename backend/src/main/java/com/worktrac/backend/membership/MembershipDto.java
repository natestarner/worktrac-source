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
 * <p>Deliberately carries no permission list. The client needs "can I write to this person" and
 * "who can I see", both derivable from these three fields; shipping the full enum would put a
 * server-side vocabulary into every persisted auth snapshot, where it would then have to be
 * version-migrated every time the enum changed.
 */
public record MembershipDto(String accountRole, Long personId, boolean membersSeeEveryone,
                             String ownerName) {

    public static MembershipDto from(AccountAccess access, String ownerName) {
        return new MembershipDto(access.accountRole().name(), access.selfPersonId(),
                access.membersSeeEveryone(), ownerName);
    }

    public static MembershipDto from(AccountMembership membership, String ownerName) {
        return new MembershipDto(
                membership.getAccountRole().name(),
                membership.getPerson() == null ? null : membership.getPerson().getId(),
                membership.getAccount().isMembersSeeEveryone(),
                ownerName);
    }
}
