package com.worktrac.backend.membership;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Pins the successor to TokenVersionService. Two things are being protected here and they pull in
// opposite directions: the cache must actually cache (it is consulted on every authenticated
// request, and a database round trip there is the pool-exhaustion path its header describes), and
// revocation must still take effect promptly.
class AccountAccessServiceTest {

    private static final long USER = 1L;
    private static final long OTHER_USER = 2L;
    private static final long ACCOUNT = 10L;
    private static final long OTHER_ACCOUNT = 20L;
    private static final int TOKEN_VERSION = 3;

    private AccountMembershipRepository repository;
    private AccountAccessService service;

    @BeforeEach
    void setUp() {
        repository = mock(AccountMembershipRepository.class);
        service = new AccountAccessService(repository);
        stub(USER, ACCOUNT, AccountRole.OWNER, 100L, TOKEN_VERSION);
    }

    private void stub(long userId, long accountId, AccountRole role, Long personId, int tokenVersion) {
        when(repository.findAccessRow(eq(userId), eq(accountId))).thenReturn(Optional.of(
                new AccountAccessRow(userId, accountId, 55L, role, personId, tokenVersion)));
    }

    @Nested
    @DisplayName("resolving")
    class Resolving {

        @Test
        void returnsTheMembershipWhenTheTokenVersionMatches() {
            Optional<AccountAccess> access = service.resolve(USER, ACCOUNT, TOKEN_VERSION);

            assertThat(access).isPresent();
            assertThat(access.get().accountRole()).isEqualTo(AccountRole.OWNER);
            assertThat(access.get().selfPersonId()).isEqualTo(100L);
            assertThat(access.get().membershipId()).isEqualTo(55L);
        }

        // A password reset bumps users.token_version. Without this the reset signed nobody out
        // anywhere else, so someone resetting precisely BECAUSE they thought they were compromised
        // stayed compromised for the token's remaining 30 days.
        @Test
        void refusesAStaleTokenVersion() {
            assertThat(service.resolve(USER, ACCOUNT, TOKEN_VERSION - 1)).isEmpty();
        }

        // What a revoked member's device sees. It must be indistinguishable from an expired
        // session, which is the 401 path the client already handles.
        @Test
        void refusesALoginWithNoMembershipInThatAccount() {
            when(repository.findAccessRow(eq(USER), eq(OTHER_ACCOUNT))).thenReturn(Optional.empty());

            assertThat(service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION)).isEmpty();
        }
    }

    @Nested
    @DisplayName("caching")
    class Caching {

        @Test
        void readsTheDatabaseOnceForRepeatedRequests() {
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);

            verify(repository, times(1)).findAccessRow(USER, ACCOUNT);
        }

        // A revoked login whose device keeps retrying must not turn into a database read per
        // request -- which is exactly the shape an offline client's reconnect storm has.
        @Test
        void cachesTheAbsenceOfAMembershipToo() {
            when(repository.findAccessRow(eq(USER), eq(OTHER_ACCOUNT))).thenReturn(Optional.empty());

            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);

            verify(repository, times(1)).findAccessRow(USER, OTHER_ACCOUNT);
        }

        // The token version is compared against the CACHED row rather than being part of the cache
        // key. Keying on it would make a stale token miss the cache on every request, handing an
        // attacker with an old token a database read per attempt.
        @Test
        void doesNotReReadWhenOnlyTheOfferedTokenVersionDiffers() {
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION - 1);

            verify(repository, times(1)).findAccessRow(USER, ACCOUNT);
        }
    }

    @Nested
    @DisplayName("invalidation")
    class Invalidation {

        @Test
        void oneMembershipIsRereadAfterInvalidate() {
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.invalidate(USER, ACCOUNT);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);

            verify(repository, times(2)).findAccessRow(USER, ACCOUNT);
        }

        // ⚠️ The property that made this worth building instead of reusing token_version: removing
        // someone from ONE household must not sign them out of the others. A token_version bump
        // would have done exactly that.
        @Test
        void invalidatingOneMembershipLeavesTheSameUsersOtherHouseholdsCached() {
            stub(USER, OTHER_ACCOUNT, AccountRole.MEMBER, 200L, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);

            service.invalidate(USER, ACCOUNT);

            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);
            verify(repository, times(1)).findAccessRow(USER, OTHER_ACCOUNT);
        }

        // The credential itself changed, so every household it reaches must be re-read.
        @Test
        void invalidateUserClearsEveryHouseholdThatLoginReaches() {
            stub(USER, OTHER_ACCOUNT, AccountRole.MEMBER, 200L, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);

            service.invalidateUser(USER);

            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);
            verify(repository, times(2)).findAccessRow(USER, ACCOUNT);
            verify(repository, times(2)).findAccessRow(USER, OTHER_ACCOUNT);
        }

        @Test
        void invalidateUserLeavesOtherPeopleAlone() {
            stub(OTHER_USER, ACCOUNT, AccountRole.MEMBER, 300L, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(OTHER_USER, ACCOUNT, TOKEN_VERSION);

            service.invalidateUser(USER);

            service.resolve(OTHER_USER, ACCOUNT, TOKEN_VERSION);
            verify(repository, times(1)).findAccessRow(OTHER_USER, ACCOUNT);
        }

        // Phase 3's visibility toggle and phase 8's plan change are both account-wide: they alter
        // what EVERY member of one household may do, so one login's eviction is not enough.
        @Test
        void invalidateAccountClearsEveryLoginInThatHousehold() {
            stub(OTHER_USER, ACCOUNT, AccountRole.MEMBER, 300L, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(OTHER_USER, ACCOUNT, TOKEN_VERSION);

            service.invalidateAccount(ACCOUNT);

            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(OTHER_USER, ACCOUNT, TOKEN_VERSION);
            verify(repository, times(2)).findAccessRow(USER, ACCOUNT);
            verify(repository, times(2)).findAccessRow(OTHER_USER, ACCOUNT);
        }

        @Test
        void invalidateAccountLeavesOtherHouseholdsAlone() {
            stub(USER, OTHER_ACCOUNT, AccountRole.MEMBER, 200L, TOKEN_VERSION);
            service.resolve(USER, ACCOUNT, TOKEN_VERSION);
            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);

            service.invalidateAccount(ACCOUNT);

            service.resolve(USER, OTHER_ACCOUNT, TOKEN_VERSION);
            verify(repository, times(1)).findAccessRow(USER, OTHER_ACCOUNT);
        }
    }
}
