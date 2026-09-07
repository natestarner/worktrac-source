package com.worktrac.backend.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

// ⚠️ A User no longer knows which account it belongs to -- account_memberships does (V63). Every
// query here that used to reach through u.account now joins that table instead.
//
// The old shape was not merely inconvenient, it was actively misleading: findByAccount_Id returned
// an Optional and emailGroupedByAccount built a Map keyed by account, both of which quietly encode
// "one login per household". The first would have thrown NonUniqueResultException on the first
// household to enable a second login; the second would have silently dropped all but one row.
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    long countByCreatedAtAfter(Instant cutoff);

    /**
     * The account's owner login, lowest membership id first.
     *
     * <p>Used by billing to put a real address on the Stripe Customer, so receipts and dunning
     * mail reach the household. It must follow the OWNER specifically: a member's address is not
     * where a billing notice belongs, and members come and go while the owner is who is paying.
     *
     * <p>Returns a List rather than an Optional because nothing in the schema stops an account
     * having two owners (a future co-owner feature would want exactly that), and a single-result
     * query would throw on the first account that did.
     */
    @Query("""
            select u from User u
            join AccountMembership m on m.user = u
            where m.account.id = :accountId
              and m.accountRole = com.worktrac.backend.membership.AccountRole.OWNER
            order by m.id asc
            """)
    List<User> findOwners(@Param("accountId") Long accountId);

    // Admin-only test-data cleanup: every account ID reachable from a login whose email matches
    // the e2e Playwright suite's exact pattern (see TestDataCleanupService for the full pattern
    // string and why it's safe to match this broadly). IDs only, not full User entities -- this is
    // the list TestDataCleanupService fans out to every other table's own bulk delete.
    @Query("""
            select m.account.id from AccountMembership m
            join m.user u
            where u.email like :pattern
            """)
    List<Long> findAccountIdsByEmailLike(@Param("pattern") String pattern);

    /**
     * Test-data cleanup, by email pattern rather than by account.
     *
     * <p>Deliberately NOT scoped to an account list any more. A member's user row can outlive the
     * household it was invited to — the membership is deleted, the credential is not — so an
     * account-scoped delete would leave orphaned e2e users accumulating in lower forever, and they
     * would only surface much later as an unrelated FK failure during some other cleanup.
     *
     * <p>Callers must delete account_memberships first; the FK is NO ACTION by design.
     */
    @Modifying
    @Query("DELETE FROM User u WHERE u.email LIKE :pattern")
    void deleteByEmailLike(@Param("pattern") String pattern);

    /**
     * Users left with no membership at all, for deletion after a household is removed.
     *
     * <p>The other half of the split above: deleting an account must not delete a credential that
     * still belongs to another household. This is what distinguishes "this login existed only for
     * the household being deleted" from "this person is also a member somewhere else".
     */
    @Query("select u.id from User u where not exists (select 1 from AccountMembership m where m.user = u)")
    List<Long> findIdsWithNoMemberships();

    // Admin-only: [accountId, email] / [accountId, role] pairs across ALL accounts, for the admin
    // portal's Accounts grid. Now scoped to OWNER memberships, so the grid keeps showing one row
    // per account -- the household's owner -- rather than fanning out to a row per login.
    // AdminService renders the member count separately.
    @Query("""
            select m.account.id, u.email from AccountMembership m join m.user u
            where m.accountRole = com.worktrac.backend.membership.AccountRole.OWNER
            """)
    List<Object[]> ownerEmailGroupedByAccount();

    @Query("""
            select m.account.id, u.role from AccountMembership m join m.user u
            where m.accountRole = com.worktrac.backend.membership.AccountRole.OWNER
            """)
    List<Object[]> ownerRoleGroupedByAccount();

    // How many logins each account has, for the admin grid. A count of memberships, not of users:
    // the same person may be a member of several households and must be counted once per account.
    @Query("select m.account.id, count(m.id) from AccountMembership m group by m.account.id")
    List<Object[]> loginCountGroupedByAccount();
}
