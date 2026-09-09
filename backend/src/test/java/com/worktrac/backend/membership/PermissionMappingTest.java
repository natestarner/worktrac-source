package com.worktrac.backend.membership;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.EnumSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// Pins AccountRole.permissions(), which is the only place in the codebase that turns a role into
// authority. Everything else asks AccountAccess.has(...), so if this table is right and nothing
// else branches on a role, the whole model is right.
//
// Deliberately exhaustive rather than spot-checked: this is the file someone will edit when they
// add a permission or a role, and a table test that only asserts the interesting rows silently
// grants whatever it forgot to mention.
class PermissionMappingTest {

    @Nested
    @DisplayName("OWNER")
    class Owner {

        @Test
        void holdsEveryPermission() {
            assertThat(AccountRole.OWNER.permissions(true)).containsExactlyInAnyOrderElementsOf(
                    EnumSet.allOf(Permission.class));
        }

        @Test
        void isUnaffectedByTheMemberVisibilitySetting() {
            assertThat(AccountRole.OWNER.permissions(false))
                    .isEqualTo(AccountRole.OWNER.permissions(true));
        }
    }

    @Nested
    @DisplayName("MEMBER")
    class Member {

        @Test
        void withVisibilityOnSeesEveryoneAndWritesOnlyTheirOwn() {
            assertThat(AccountRole.MEMBER.permissions(true)).containsExactlyInAnyOrder(
                    Permission.VIEW_OWN_PERSON,
                    Permission.WRITE_OWN_PERSON,
                    Permission.CHANGE_OWN_PASSWORD,
                    Permission.VIEW_OTHER_PEOPLE,
                    Permission.CREATE_SHARED_RESOURCE,
                    Permission.EDIT_OWN_SHARED_RESOURCE,
                    Permission.DELETE_OWN_SHARED_RESOURCE);
        }

        @Test
        void withVisibilityOffSeesOnlyThemselves() {
            assertThat(AccountRole.MEMBER.permissions(false)).containsExactlyInAnyOrder(
                    Permission.VIEW_OWN_PERSON,
                    Permission.WRITE_OWN_PERSON,
                    Permission.CHANGE_OWN_PASSWORD,
                    Permission.CREATE_SHARED_RESOURCE,
                    Permission.EDIT_OWN_SHARED_RESOURCE,
                    Permission.DELETE_OWN_SHARED_RESOURCE);
        }

        // The single most important row in the table: "members can see everyone" is a VISIBILITY
        // switch. There is no configuration of it, and no role short of OWNER, under which one
        // member may write to another person's training data.
        @Test
        void canNeverWriteToAnotherPerson() {
            assertThat(AccountRole.MEMBER.permissions(true)).doesNotContain(Permission.WRITE_OTHER_PEOPLE);
            assertThat(AccountRole.MEMBER.permissions(false)).doesNotContain(Permission.WRITE_OTHER_PEOPLE);
        }

        // Creating a custom exercise is a durable offline write, and a 403 on one of those is
        // terminal -- it would discard the create AND every set queued behind its temp id. So this
        // must stay granted regardless of visibility. See Permission.CREATE_SHARED_RESOURCE.
        @Test
        void canAlwaysCreateASharedResource() {
            assertThat(AccountRole.MEMBER.permissions(true)).contains(Permission.CREATE_SHARED_RESOURCE);
            assertThat(AccountRole.MEMBER.permissions(false)).contains(Permission.CREATE_SHARED_RESOURCE);
        }

        @Test
        void cannotManageTheHouseholdUnderEitherSetting() {
            Set<Permission> ownerOnly = EnumSet.of(
                    Permission.MANAGE_PEOPLE,
                    Permission.MANAGE_HOUSEHOLD,
                    Permission.MANAGE_LOGINS,
                    Permission.MANAGE_BILLING,
                    Permission.DELETE_ACCOUNT,
                    Permission.IMPORT_DATA,
                    Permission.EXPORT_ACCOUNT_DATA,
                    Permission.EDIT_ANY_SHARED_RESOURCE,
                    Permission.DELETE_SHARED_RESOURCE);
            assertThat(AccountRole.MEMBER.permissions(true)).doesNotContainAnyElementsOf(ownerOnly);
            assertThat(AccountRole.MEMBER.permissions(false)).doesNotContainAnyElementsOf(ownerOnly);
        }
    }

    @Nested
    @DisplayName("the returned sets")
    class ReturnedSets {

        // Shared immutable instances, so a caller cannot widen its own authority by mutating what
        // it was handed. Cheap to get wrong: EnumSet.of(...) returns a mutable set.
        @Test
        void areImmutable() {
            assertThatThrownBy(() -> AccountRole.MEMBER.permissions(true).add(Permission.DELETE_ACCOUNT))
                    .isInstanceOf(UnsupportedOperationException.class);
            assertThatThrownBy(() -> AccountRole.OWNER.permissions(true).remove(Permission.MANAGE_BILLING))
                    .isInstanceOf(UnsupportedOperationException.class);
        }
    }

    @Nested
    @DisplayName("AccountAccess")
    class Access {

        private AccountAccess member(boolean seesEveryone, Long selfPersonId) {
            return new AccountAccess(7L, 3L, 11L, AccountRole.MEMBER, selfPersonId, seesEveryone, true);
        }

        @Test
        void hasDelegatesToTheRoleTable() {
            assertThat(member(true, 5L).has(Permission.VIEW_OTHER_PEOPLE)).isTrue();
            assertThat(member(false, 5L).has(Permission.VIEW_OTHER_PEOPLE)).isFalse();
            assertThat(member(true, 5L).has(Permission.WRITE_OTHER_PEOPLE)).isFalse();
        }

        @Test
        void isSelfIsIdentityOnly() {
            assertThat(member(true, 5L).isSelf(5L)).isTrue();
            assertThat(member(true, 5L).isSelf(6L)).isFalse();
        }

        // A membership with no person attached (a legitimate state -- an owner need not correspond
        // to a person) must not accidentally match a null personId and grant self-access.
        @Test
        void isSelfIsFalseWhenTheMembershipHasNoPerson() {
            assertThat(member(true, null).isSelf(5L)).isFalse();
            assertThat(member(true, null).isSelf(null)).isFalse();
        }

        @Test
        void ownerOfBuildsAFullOwner() {
            AccountAccess access = AccountAccess.ownerOf(1L, 2L);
            assertThat(access.accountRole()).isEqualTo(AccountRole.OWNER);
            assertThat(access.accountId()).isEqualTo(2L);
            assertThat(access.has(Permission.WRITE_OTHER_PEOPLE)).isTrue();
        }

        @Test
        void refusesToBeBuiltWithoutAnIdentity() {
            assertThatThrownBy(() -> new AccountAccess(null, 3L, 11L, AccountRole.MEMBER, 5L, true, true))
                    .isInstanceOf(NullPointerException.class);
            assertThatThrownBy(() -> new AccountAccess(7L, null, 11L, AccountRole.MEMBER, 5L, true, true))
                    .isInstanceOf(NullPointerException.class);
            assertThatThrownBy(() -> new AccountAccess(7L, 3L, 11L, null, 5L, true, true))
                    .isInstanceOf(NullPointerException.class);
        }
    }
}
