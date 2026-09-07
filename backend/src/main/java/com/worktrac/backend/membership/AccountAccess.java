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
        boolean membersSeeEveryone,
        /**
         * Whether the HOUSEHOLD is on Pro — {@code SubscriptionService.isPro}, resolved once per
         * cache load rather than per request.
         *
         * <p>⚠️ Not stored anywhere. It is derived from a subscription's state, including a
         * time-dependent branch (a cancelled subscription stays Pro until its paid period ends,
         * with no webhook to announce that). So this value can be up to the cache TTL stale, and
         * that is accepted: a member keeps working for at most another minute after a plan lapses.
         * Erring in that direction is deliberate — the opposite error locks somebody out of the
         * app mid-workout over a billing edge the household may not even know about yet.
         */
        boolean accountIsPro) {

    public AccountAccess {
        Objects.requireNonNull(userId, "userId");
        Objects.requireNonNull(accountId, "accountId");
        Objects.requireNonNull(accountRole, "accountRole");
    }

    public boolean has(Permission permission) {
        return accountRole.permissions(membersSeeEveryone).contains(permission);
    }

    /**
     * Whether this login may be used at all right now, as opposed to what it may do.
     *
     * <p>⚠️ <b>An OWNER is never paused, and that is not a courtesy — it is what makes the pause
     * recoverable.</b> Downgrading suspends the member logins; the owner keeps full access to the
     * whole household, which is both the shared-iPad flow the product started as and the only way
     * anybody can get back to Pro. Pausing the owner too would lock the household out of the
     * screen that un-pauses it.
     *
     * <p>Checked from {@code PermissionInterceptor} before any permission, because it is a
     * different question: not "may you do this" but "may you do anything".
     */
    public MembershipStatus status() {
        return accountRole == AccountRole.MEMBER && !accountIsPro
                ? MembershipStatus.PAUSED_PLAN
                : MembershipStatus.ACTIVE;
    }

    /** True when this login IS the given person, rather than merely able to act on them. */
    public boolean isSelf(Long personId) {
        return selfPersonId != null && selfPersonId.equals(personId);
    }

    /**
     * The person this login IS, insisting there is one.
     *
     * <p>For the checks that ask "has anyone OTHER than me used this", where the person id becomes
     * a {@code <> :personId} comparison. A null there would not fail — it would match every row and
     * report "used by nobody", quietly waving through exactly the rename the check exists to
     * refuse. So this fails loudly instead of failing open.
     *
     * <p>Only ever reached for a MEMBER (an owner short-circuits on
     * {@code EDIT_ANY_SHARED_RESOURCE} first), and a member always has a person —
     * {@code UX_account_memberships_account_person} is what makes that true. An
     * {@code IllegalStateException} here means that invariant broke, which is a 500 and correctly
     * so: it is not a request the caller can fix.
     */
    public Long requireSelfPersonId() {
        if (selfPersonId == null) {
            throw new IllegalStateException("Membership has no person: " + membershipId);
        }
        return selfPersonId;
    }

    /**
     * Whether this login may change a shared account resource -- an exercise or a tag -- given who
     * created it.
     *
     * <p>Lives here, beside has() and isSelf(), because it is the same kind of question and because
     * keeping it here keeps AccountRole the only place a role is ever consulted. The two call sites
     * (ExerciseService.update, TagService.rename) act on different entity types, so the creator is
     * passed as a bare id rather than the row.
     *
     * <p><b>A null creator answers FALSE for a member, and that polarity is deliberate.</b> Null
     * means nobody in this household is recorded as having made the row: a preloaded global
     * exercise, a row written by the previous release during a rolling deploy, or an account with
     * no OWNER membership for V69 to attribute to. An owner still edits it through
     * EDIT_ANY_SHARED_RESOURCE, so nothing becomes uneditable -- but a member never inherits a row
     * nobody claims. Failing open here would hand every member every unattributed row in the
     * household, which is precisely the wrong direction to be wrong in.
     *
     * <p>⚠️ This answers EDIT only. Deletion is DELETE_SHARED_RESOURCE and has no ownership
     * component at all: a shared row that someone else's history already references is not the
     * creator's alone to remove. Do not grow a "delete what you created" branch in here without
     * that decision being made deliberately -- see the plan's Decisions table.
     */
    public boolean mayEditSharedResource(Long createdByUserId) {
        if (has(Permission.EDIT_ANY_SHARED_RESOURCE)) {
            return true;
        }
        return has(Permission.EDIT_OWN_SHARED_RESOURCE)
                && userId != null
                && createdByUserId != null
                && createdByUserId.equals(userId);
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
        // accountIsPro true: an OWNER's status() ignores it entirely, so the value is arbitrary --
        // but true is the one that cannot mislead a reader into thinking owners can be paused.
        return new AccountAccess(userId, accountId, null, AccountRole.OWNER, null, true, true);
    }
}
