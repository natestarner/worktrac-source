package com.worktrac.backend.membership;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

// A login's role INSIDE ONE ACCOUNT. Not to be confused with users.role, which is the
// platform-level USER/ADMIN flag sourced from ADMIN_EMAILS and used only to gate /api/admin/**.
// The two are independent on purpose: a Huddle admin is not thereby an owner of anyone's
// household, and a household owner is not thereby a Huddle admin.
//
// ⚠️ THE MAP BELOW IS THE ONLY PLACE IN THE CODEBASE THAT BRANCHES ON A ROLE. Everything else
// asks AccountAccess.has(Permission). Keep it that way -- it is the entire reason adding MANAGER
// was a change here rather than a change at 36 guard call sites, which is exactly what the earlier
// comment here predicted it would buy.
public enum AccountRole {

    /** The registrant. Holds every permission. */
    OWNER,

    /**
     * Full reach over everyone in the account, but no say over the account itself.
     *
     * <p>An assistant trainer in a Pro practice, an assistant coach on a Team, or simply a second
     * parent on a family account. Named for the RELATIONSHIP to the account rather than for a job
     * in the gym, the same way OWNER and MEMBER are -- "coach" would have read wrongly in two of
     * those three cases and would have collided with Team's own display vocabulary.
     *
     * <p>Deliberately NOT called ADMIN: {@code users.role} is already a platform-level USER/ADMIN
     * flag, and this enum's header exists because confusing the two axes is a live hazard.
     */
    MANAGER,

    /** A member with their own login: their own workouts, and nobody else's unless the account says so. */
    MEMBER;

    private static final Set<Permission> OWNER_PERMISSIONS =
            Collections.unmodifiableSet(EnumSet.allOf(Permission.class));

    // Everything an OWNER can do EXCEPT the four things that are about the account rather than
    // about the people in it. Enumerated positively rather than as "allOf minus these", and that is
    // load-bearing: OWNER_PERMISSIONS is allOf, so a permission added later is granted to owners
    // automatically and NOT to managers. That asymmetry fails CLOSED, which is the right direction
    // -- but it is silent, so PermissionMappingTest states it as a deliberate decision rather than
    // leaving the next person to discover it.
    //
    // ⚠️ EXPORT_ACCOUNT_DATA is excluded on purpose, and it is the least obvious of the four. That
    // permission was split off from ordinary per-person export precisely so "can see everyone"
    // could not silently become "can walk out with the whole roster in one click" -- an argument
    // that applies with MORE force to an assistant than it did to a family member.
    private static final Set<Permission> MANAGER_PERMISSIONS = managerPermissions();

    private static Set<Permission> managerPermissions() {
        EnumSet<Permission> permissions = EnumSet.allOf(Permission.class);
        permissions.remove(Permission.MANAGE_BILLING);
        permissions.remove(Permission.DELETE_ACCOUNT);
        permissions.remove(Permission.MANAGE_HOUSEHOLD);
        permissions.remove(Permission.EXPORT_ACCOUNT_DATA);
        return Collections.unmodifiableSet(permissions);
    }

    // A member always controls their own training and can add to the shared catalog. What varies
    // is whether they can SEE the rest of the household -- and note there is no variant in which
    // they can WRITE to it. "Members can see everyone" is a visibility switch, never a write one.
    private static final Set<Permission> MEMBER_BASE = Collections.unmodifiableSet(EnumSet.of(
            Permission.VIEW_OWN_PERSON,
            Permission.WRITE_OWN_PERSON,
            // Their credential, not the household's. See Permission.CHANGE_OWN_PASSWORD for why
            // there is no owner-side counterpart to this one.
            Permission.CHANGE_OWN_PASSWORD,
            Permission.CREATE_SHARED_RESOURCE,
            Permission.EDIT_OWN_SHARED_RESOURCE,
            Permission.DELETE_OWN_SHARED_RESOURCE));

    private static final Set<Permission> MEMBER_SEEING_EVERYONE = memberSeeingEveryone();

    private static Set<Permission> memberSeeingEveryone() {
        EnumSet<Permission> seeing = EnumSet.copyOf(MEMBER_BASE);
        seeing.add(Permission.VIEW_OTHER_PEOPLE);
        return Collections.unmodifiableSet(seeing);
    }

    /**
     * The permissions this role holds, given the account's member-visibility setting.
     *
     * membersSeeEveryone is an ACCOUNT property, not a role property, which is why it is a
     * parameter rather than a field: the same MEMBER role means something different in a family
     * household (everyone sees everyone, forced on) than in a Pro practice, where a client sees
     * only themselves. Passing it in keeps the dependency visible instead of hiding it behind a
     * lookup.
     *
     * <p>⚠️ It affects MEMBER only. An OWNER and a MANAGER see and write everyone regardless — the
     * setting is about what a member may see, never about what the people running the account may.
     * A Pro trainer whose clients are private must still be able to open every one of them, which
     * is the entire point of the tier.
     */
    public Set<Permission> permissions(boolean membersSeeEveryone) {
        return switch (this) {
            case OWNER -> OWNER_PERMISSIONS;
            case MANAGER -> MANAGER_PERMISSIONS;
            case MEMBER -> membersSeeEveryone ? MEMBER_SEEING_EVERYONE : MEMBER_BASE;
        };
    }
}
