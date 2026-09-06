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

    // ── Household-scoped ─────────────────────────────────────────────────────────────────────
    /** Add or remove a person, and rename/configure someone who is not you. */
    MANAGE_PEOPLE,
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
    DELETE_SHARED_RESOURCE
}
