package com.worktrac.backend.person;

import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.membership.AccountAccess;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.quota.QuotaService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

// The two guards that replaced requireOwnedPerson, tested against a MEMBER before any member
// login can exist.
//
// This is possible now -- rather than waiting for the membership table -- precisely because the
// guards take an AccountAccess as a PARAMETER instead of reaching into the security context. A
// synthetic MEMBER is a record literal, so the behaviour that will matter most in production is
// pinned in the fast unit tier, three phases before anything can exercise it for real.
class PersonGuardTest {

    private static final long ACCOUNT = 10L;
    private static final long ME = 100L;
    private static final long SIBLING = 200L;

    private PersonRepository personRepository;
    private PersonService personService;

    @BeforeEach
    void setUp() {
        personRepository = mock(PersonRepository.class);
        personService = new PersonService(personRepository, mock(AccountRepository.class), mock(QuotaService.class));

        // Built BEFORE the stubbing below: person() stubs a mock of its own, and creating it
        // inside a when(...) argument nests one stubbing inside another (UnfinishedStubbing).
        Person me = person(ME);
        Person sibling = person(SIBLING);

        when(personRepository.findByIdAndAccount_Id(any(), any())).thenReturn(Optional.empty());
        when(personRepository.findByIdAndAccount_Id(eq(ME), eq(ACCOUNT))).thenReturn(Optional.of(me));
        when(personRepository.findByIdAndAccount_Id(eq(SIBLING), eq(ACCOUNT))).thenReturn(Optional.of(sibling));
    }

    private static Person person(long id) {
        Person person = mock(Person.class);
        when(person.getId()).thenReturn(id);
        return person;
    }

    private static AccountAccess owner() {
        return new AccountAccess(1L, ACCOUNT, 5L, AccountRole.OWNER, ME, true, true);
    }

    private static AccountAccess member(boolean seesEveryone) {
        return new AccountAccess(2L, ACCOUNT, 6L, AccountRole.MEMBER, ME, seesEveryone, true);
    }

    @Nested
    @DisplayName("an owner")
    class Owner {

        @Test
        void canReadAndWriteAnyoneInTheHousehold() {
            assertThat(personService.requireVisiblePerson(SIBLING, owner()).getId()).isEqualTo(SIBLING);
            assertThat(personService.requireWritablePerson(SIBLING, owner()).getId()).isEqualTo(SIBLING);
        }

        // The pre-existing property, and the reason the guard 404s rather than 403s: a caller must
        // never be able to tell "doesn't exist" from "belongs to someone else".
        @Test
        void gets404ForAPersonInAnotherAccount() {
            assertThatThrownBy(() -> personService.requireVisiblePerson(999L, owner()))
                    .isInstanceOf(NotFoundException.class);
            assertThatThrownBy(() -> personService.requireWritablePerson(999L, owner()))
                    .isInstanceOf(NotFoundException.class);
        }
    }

    @Nested
    @DisplayName("a member, with household visibility ON (the shipping configuration)")
    class MemberSeeingEveryone {

        @Test
        void canReadAndWriteThemselves() {
            assertThat(personService.requireVisiblePerson(ME, member(true)).getId()).isEqualTo(ME);
            assertThat(personService.requireWritablePerson(ME, member(true)).getId()).isEqualTo(ME);
        }

        @Test
        void canReadASibling() {
            assertThat(personService.requireVisiblePerson(SIBLING, member(true)).getId()).isEqualTo(SIBLING);
        }

        // The whole point of the feature. 403 and not 404 here is deliberate: with visibility on
        // the member is looking at that person's name on screen, so a "doesn't exist" would be a
        // lie the UI immediately contradicts.
        @Test
        void cannotWriteASibling() {
            assertThatThrownBy(() -> personService.requireWritablePerson(SIBLING, member(true)))
                    .isInstanceOf(ForbiddenException.class)
                    .hasMessageContaining("your own");
        }
    }

    @Nested
    @DisplayName("a member, with household visibility OFF (the Team-tier seam)")
    class MemberSeeingOnlyThemselves {

        @Test
        void canStillReadAndWriteThemselves() {
            assertThat(personService.requireVisiblePerson(ME, member(false)).getId()).isEqualTo(ME);
            assertThat(personService.requireWritablePerson(ME, member(false)).getId()).isEqualTo(ME);
        }

        // 404, NOT 403 -- a member who cannot see a person must not learn that they exist. This is
        // the one place the two guards must disagree about which status to use.
        @Test
        void gets404ForASiblingTheyCannotSee() {
            assertThatThrownBy(() -> personService.requireVisiblePerson(SIBLING, member(false)))
                    .isInstanceOf(NotFoundException.class);
            assertThatThrownBy(() -> personService.requireWritablePerson(SIBLING, member(false)))
                    .isInstanceOf(NotFoundException.class);
        }
    }

    @Nested
    @DisplayName("the already-loaded overloads used by the child-id endpoints")
    class PreloadedOverloads {

        // PATCH /api/sets/{setId} and friends never see a personId -- they prove tenancy by walking
        // the FK chain to the account, then hand the resolved person here. The caller supplies its
        // own message because what the caller was asking for is a set, not a person.
        @Test
        void carryTheCallersOwnNotFoundMessage() {
            assertThatThrownBy(() -> personService.requireWritablePerson(
                    person(SIBLING), member(false), "We couldn't find that set."))
                    .isInstanceOf(NotFoundException.class)
                    .hasMessage("We couldn't find that set.");
        }

        @Test
        void refuseAWriteToASiblingTheMemberCanSee() {
            assertThatThrownBy(() -> personService.requireWritablePerson(
                    person(SIBLING), member(true), "We couldn't find that set."))
                    .isInstanceOf(ForbiddenException.class);
        }

        @Test
        void allowAReadOfASiblingTheMemberCanSee() {
            assertThat(personService.requireVisiblePerson(
                    person(SIBLING), member(true), "We couldn't find that set.").getId()).isEqualTo(SIBLING);
        }

        @Test
        void allowAMemberToWriteTheirOwn() {
            assertThat(personService.requireWritablePerson(
                    person(ME), member(true), "We couldn't find that set.").getId()).isEqualTo(ME);
        }
    }
}
