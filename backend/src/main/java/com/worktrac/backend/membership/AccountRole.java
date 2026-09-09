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
// asks AccountAccess.has(Permission). Keep it that way -- it is the entire reason adding a COACH
// role later is a change here rather than a change at 36 guard call sites.
public enum AccountRole {

    /** The registrant. Today the only role any real login has. Holds every permission. */
    OWNER,

    /** A household member with their own login: their own workouts, and nobody else's. */
    MEMBER;

    private static final Set<Permission> OWNER_PERMISSIONS =
            Collections.unmodifiableSet(EnumSet.allOf(Permission.class));

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
     * household (everyone sees everyone, forced on) than it will on a Team account. Passing it in
     * keeps the dependency visible instead of hiding it behind a lookup.
     */
    public Set<Permission> permissions(boolean membersSeeEveryone) {
        if (this == OWNER) {
            return OWNER_PERMISSIONS;
        }
        return membersSeeEveryone ? MEMBER_SEEING_EVERYONE : MEMBER_BASE;
    }
}
