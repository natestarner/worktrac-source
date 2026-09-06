package com.worktrac.backend.membership;

import java.util.Objects;

// Everything the app needs to answer "what may this login do in this account?", resolved once per
// request and passed explicitly from there on.
//
// ── WHY THIS IS NOT A JWT CLAIM ───────────────────────────────────────────────────────────────
// Putting accountRole in the token was considered and rejected. Every token minted before the
// claim existed would carry no role, and there is no safe default: absent -> OWNER fails OPEN,
// absent -> MEMBER locks every existing user out for the 30-day token lifetime. That is the exact
// trap JwtService's own comments describe for the `role` and `tv` claims, where a safe default
// happened to exist. Here none does.
//
// A token claim would also freeze the answer for thirty days, so revoking a membership, changing a
// role, or a plan lapsing would not take effect until the token expired. Resolving server-side
// means those take effect on the next request (see AccountAccessService from Phase 2).
//
// ── WHY IT IS PASSED, NOT LOOKED UP ───────────────────────────────────────────────────────────
// Services take this as a parameter rather than calling into the security context themselves.
// The dependency stays visible in the signature, a test can construct one directly without
// standing up a SecurityContext, and there is no hidden thread-local to reason about when
// debugging. It replaces the bare `Long accountId` that used to be threaded the same way --
// accountId() is still right here, so nothing lost expressiveness.
public record AccountAccess(
        Long userId,
        Long accountId,
        /** The account_memberships row id. Null until Phase 2 creates that table. */
        Long membershipId,
        AccountRole accountRole,
        /**
         * The person this login IS, if any -- account_memberships.person_id.
         *
         * ⚠️ This is an IDENTITY field, not an authority. Every decision must still go through
         * has(Permission); the moment a call site compares personId == selfPersonId directly, the
         * visibility setting stops being honoured in that one place. The guards in PersonService
         * are the only code allowed to combine the two.
         *
         * Null is legitimate: an owner need not correspond to a person at all.
         */
        Long selfPersonId,
        /** accounts.members_see_everyone. Forced true for Pro/Family; the Team tier's seam. */
        boolean membersSeeEveryone) {

    public AccountAccess {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(accountId, "accountId");
        Objects.requireNonNull(accountRole, "accountRole");
    }

    public boolean has(Permission permission) {
        return accountRole.permissions(membersSeeEveryone).contains(permission);
    }

    /** True when this login IS the given person, rather than merely able to act on them. */
    public boolean isSelf(Long personId) {
        return selfPersonId != null && selfPersonId.equals(personId);
    }

    /**
     * The access an account's owner has.
     *
     * Phase 1 has no account_memberships table yet, so every authenticated login is by definition
     * the account's single owner and this is the only way an AccountAccess is built. Phase 2
     * replaces the call site in JwtAuthenticationFilter with a real cached membership lookup and
     * this factory survives only for tests. Nothing else about the model changes then, which is
     * the point of introducing the type now: the guards, the permission map and all 36 call sites
     * are already exercised in production before a MEMBER can exist.
     */
    public static AccountAccess ownerOf(Long userId, Long accountId) {
        return new AccountAccess(userId, accountId, null, AccountRole.OWNER, null, true);
    }
}
