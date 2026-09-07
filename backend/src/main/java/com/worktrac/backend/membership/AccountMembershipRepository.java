package com.worktrac.backend.membership;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface AccountMembershipRepository extends JpaRepository<AccountMembership, Long> {

    /**
     * The per-request access lookup, as ONE query.
     *
     * <p>This is the hottest query in the app after the token parse -- AccountAccessService calls
     * it on every cache miss, and every authenticated request consults that cache. It projects
     * straight into a record rather than loading entities so it touches no lazy proxies and starts
     * no second query; joining `users` for the token version here is what keeps the whole
     * "is this token still valid, and what may it do" question to a single round trip.
     *
     * <p>LEFT join on person: a membership with no person is legitimate (see AccountMembership).
     * An inner join would silently make such a login fail to authenticate at all.
     */
    @Query("""
            select new com.worktrac.backend.membership.AccountAccessRow(
                u.id, a.id, m.id, m.accountRole, p.id, u.tokenVersion, a.membersSeeEveryone)
            from AccountMembership m
            join m.user u
            join m.account a
            left join m.person p
            where u.id = :userId and a.id = :accountId
            """)
    Optional<AccountAccessRow> findAccessRow(@Param("userId") Long userId, @Param("accountId") Long accountId);

    /** Every household this login belongs to. Drives the account picker and "switch household". */
    List<AccountMembership> findByUser_IdOrderByCreatedAtAscIdAsc(Long userId);

    List<AccountMembership> findByAccount_Id(Long accountId);

    Optional<AccountMembership> findByAccount_IdAndUser_Id(Long accountId, Long userId);

    Optional<AccountMembership> findByAccount_IdAndPerson_Id(Long accountId, Long personId);

    long countByUser_Id(Long userId);

    /**
     * The account's owner, lowest membership id first.
     *
     * <p>Returns a List, not an Optional, on purpose: nothing in the schema stops an account
     * having two OWNERs (a future co-owner feature would want exactly that), and a single-result
     * query would throw NonUniqueResultException on the first account that did. Callers that need
     * "the" owner -- the Stripe customer, the admin grid's account email -- take the first and are
     * commented as making that choice.
     */
    @Query("""
            select m from AccountMembership m
            where m.account.id = :accountId and m.accountRole = com.worktrac.backend.membership.AccountRole.OWNER
            order by m.id asc
            """)
    List<AccountMembership> findOwners(@Param("accountId") Long accountId);

    /**
     * The household owner's person NAME, and nothing else about them.
     *
     * <p>Returns names rather than entities because every caller wants exactly one string, and
     * because keeping it that narrow is the point: a member is told who to ask, never given an
     * email, an id, or anything they could act on outside the app.
     *
     * <p>A list with an explicit ORDER BY rather than a single result: the schema permits more than
     * one OWNER membership even though the app never creates one, and an unordered single-result
     * query would throw for such an account instead of picking deterministically. Same reasoning as
     * V64's primary-person subquery. Empty when the account has no owner, or none with a person —
     * both of which callers must render as "nobody named".
     */
    @Query("SELECT m.person.name FROM AccountMembership m "
            + "WHERE m.account.id = :accountId AND m.accountRole = :role AND m.person IS NOT NULL "
            + "ORDER BY m.createdAt ASC, m.id ASC")
    List<String> findOwnerPersonNames(@Param("accountId") Long accountId, @Param("role") AccountRole role);

    void deleteByAccount_Id(Long accountId);

    void deleteByAccount_IdIn(List<Long> accountIds);

    // Admin-only: [accountId, count] pairs across ALL accounts, for the admin portal's per-household
    // logins count. Same shape and same reasoning as PersonRepository.countGroupedByAccount --
    // Object[] rather than a projection type, because this is a one-off internal aggregate consumed
    // only by AdminService, and one grouped query rather than a lookup per row, because that list
    // already fans out across every account in the database.
    @Query("SELECT m.account.id, COUNT(m) FROM AccountMembership m GROUP BY m.account.id")
    List<Object[]> countGroupedByAccount();
}
