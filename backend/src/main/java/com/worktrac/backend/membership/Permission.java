package com.worktrac.backend.membership;

// What a login is allowed to do inside one account.
//
// ⚠️ CALL SITES ASK FOR A PERMISSION, NEVER FOR A ROLE. There is exactly one place in the whole
// codebase that compares against AccountRole -- AccountRole.permissions() -- and adding a second
// is the bug. That is what makes a future COACH role (or a per-account override) a change to one
// map instead of a change to every guard, and it is why this enum exists at all rather than
// `if (role == OWNER)` scattered through the services.
//
// Two kinds live here and they are not interchangeable:
//
//   PERSON-SCOPED  -- meaningless on their own. VIEW_OTHER_PEOPLE does not say "you may read
//                     person 7"; it says "being someone else is not by itself a reason to refuse
//                     you". The actual decision is PersonService.requireVisiblePerson /
//                     requireWritablePerson, which combine the permission with the caller's own
//                     personId. An interceptor cannot make this call: it has no idea which person
//                     a {setId} belongs to.
//
//   HOUSEHOLD-SCOPED -- answerable from the AccountAccess alone, so PermissionInterceptor enforces
//                     them declaratively from @RequiresPermission and no service code is involved.
public enum Permission {

    // ── Person-scoped ────────────────────────────────────────────────────────────────────────
    VIEW_OWN_PERSON,
    WRITE_OWN_PERSON,
    VIEW_OTHER_PEOPLE,
    WRITE_OTHER_PEOPLE,
    /**
     * Change the training data or settings of the person the account's OWNER is.
     *
     * <p>Narrower than it looks: {@link #WRITE_OTHER_PEOPLE} says "being someone else is not by
     * itself a reason to refuse you", and this says the same for the one other person who is
     * special. A MANAGER (the family's "trusted member", a practice's assistant) logs for everyone
     * else in the account, but the owner's own log stays the owner's — a second parent logging for
     * the kids must not be able to rewrite the account holder's sets, and an assistant must not be
     * able to edit their trainer's.
     *
     * <p>Only ever consulted by {@code PersonService}'s write guard, together with "is this person
     * the owner's?" — it cannot be decided from the {@link AccountAccess} alone, so it is
     * person-scoped like the four above it. OWNER holds it via {@code allOf}; nobody else does.
     */
    WRITE_ACCOUNT_OWNER,

    // ── Self-scoped, but answerable from the AccountAccess alone ─────────────────────────────
    /**
     * Change YOUR OWN password, having proved you know the current one.
     *
     * Held by every role, and that is the point rather than an oversight: it is the permission
     * that has no owner-only counterpart anywhere. An owner may invite, revoke and unlock a member
     * — but there is deliberately no CHANGE_ANY_PASSWORD, because an owner who can set a member's
     * password can impersonate them, which is exactly what a teenager will object to and a terrible
     * story for a future Team tier.
     *
     * <p>⚠️ The member's Profile page carries the sentence "{owner} cannot see or set your
     * password" as a standing promise. THIS is what makes it true. If a permission to set somebody
     * else's password is ever added, that copy has to change in the same commit.
     */
    CHANGE_OWN_PASSWORD,
    /**
     * Connect or disconnect YOUR OWN Apple or Google sign-in. Held by every role, for exactly the
     * reason {@link #CHANGE_OWN_PASSWORD} is: it is a way into one person's login, and nobody else
     * -- an owner included -- may add one. An owner who could attach their own Google account to a
     * member's login could sign in as that member.
     */
    MANAGE_OWN_SIGN_IN_METHODS,

    // ── Household-scoped ─────────────────────────────────────────────────────────────────────
    /** Add a person, and rename/configure someone who is not you. */
    MANAGE_PEOPLE,
    /**
     * Remove a person — which deletes every session, set and routine they own.
     *
     * <p>Split off {@link #MANAGE_PEOPLE} when the MANAGER role became assignable: a trusted member
     * may add the new kid and fix a misspelt name, but wiping somebody's whole training history is
     * the account holder's call alone. Owner-only.
     */
    REMOVE_PEOPLE,
    /**
     * Make a login a MANAGER, or a MEMBER again — and remove a MANAGER's login.
     *
     * <p>Owner-only, so a manager can never promote somebody else to their own level, or demote or
     * remove a fellow manager. Who holds the household's widest powers is the owner's decision.
     */
    ASSIGN_ROLES,
    /** Household name, default unit, and (Team tier) the member-visibility setting. */
    MANAGE_HOUSEHOLD,
    /** Invite, resend, revoke and unlock member logins. Never "set someone's password". */
    MANAGE_LOGINS,
    MANAGE_BILLING,
    DELETE_ACCOUNT,
    IMPORT_DATA,
    /**
     * The whole household in one file (/api/export/all.zip).
     *
     * Deliberately NOT the same as reading one person's export.csv, which follows VIEW and so is
     * available to a member for anyone they can already see. Without the split, "members can see
     * everyone's workouts" silently becomes "any member can walk out with the household's complete
     * training history in a single click".
     */
    EXPORT_ACCOUNT_DATA,

    // ── Shared account resources (the custom exercise catalog, tags) ─────────────────────────
    /**
     * Create a custom exercise or tag.
     *
     * This stays open to every member and must never become owner-only: creating a custom exercise
     * is a durable offline write, and a 403 on a durable write is terminal -- it would discard the
     * create permanently AND every set queued behind its temp id.
     */
    CREATE_SHARED_RESOURCE,
    /** Rename/retag a row this login created (exercises.created_by_user_id). */
    EDIT_OWN_SHARED_RESOURCE,
    EDIT_ANY_SHARED_RESOURCE,
    /**
     * Delete ANY shared resource, unconditionally -- no ownership check, no in-use check. The
     * owner's long-standing power over the whole catalog, unaffected by {@link
     * #DELETE_OWN_SHARED_RESOURCE} existing: exercises still have no member-facing delete at all,
     * so for them this remains the only way one is ever removed.
     */
    DELETE_SHARED_RESOURCE,
    /**
     * Delete a row this login created, once nobody else depends on it -- see {@code
     * AccountAccess.mayDeleteSharedResource} and {@code TagService.delete}. Tags only, today:
     * created-by-you plus not-used-by-anyone-else is a *narrower* grant than {@link
     * #DELETE_SHARED_RESOURCE}, not a rename of it, so exercises are untouched and stay owner-only.
     */
    DELETE_OWN_SHARED_RESOURCE
}
