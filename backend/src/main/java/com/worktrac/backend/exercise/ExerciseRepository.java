package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ExerciseRepository extends JpaRepository<Exercise, Long> {

    // Quota enforcement (QuotaService). Own, live exercises only: the preloaded global catalog has
    // a null account and must not count against anyone, and a soft-deleted row is not something
    // the household still holds.
    long countByAccount_IdAndDeletedFalse(Long accountId);


    // Every global (shared) exercise, plus this account's own exercises.
    @Query("SELECT e FROM Exercise e WHERE e.deleted = false AND ("
            + "e.account IS NULL OR e.account.id = :accountId) ORDER BY e.name ASC")
    List<Exercise> findVisibleToAccount(@Param("accountId") Long accountId);

    Optional<Exercise> findByIdAndAccount_Id(Long id, Long accountId);

    // Account-scoped idempotency lookup for exercise creation, so a replayed offline create returns
    // the already-committed exercise instead of inserting a duplicate.
    Optional<Exercise> findByClientKeyAndAccount_Id(String clientKey, Long accountId);

    // Same-name, same-measure lookup over everything visible to this account, so a create can
    // return an exercise that already exists rather than inserting a second one. Scoping mirrors
    // findVisibleToAccount exactly -- a preloaded global "Bench Press" is just as much a duplicate
    // as the account's own.
    //
    // Returns a List, NOT an Optional: nothing prevented duplicate names until now, so accounts in
    // the wild already hold several rows that match, and a single-result query would throw
    // NonUniqueResultException on exactly the data this feature exists to stop growing. The ORDER BY
    // encodes the same preference the client's resolveExerciseCreate applies -- the account's own
    // exercise before a global one (theirs is the one they have been logging against), then lowest
    // id so repeat lookups agree.
    @Query("SELECT e FROM Exercise e WHERE e.deleted = false "
            + "AND (e.account IS NULL OR e.account.id = :accountId) "
            + "AND LOWER(e.name) = LOWER(:name) AND e.trackingType = :trackingType "
            + "ORDER BY CASE WHEN e.account IS NULL THEN 1 ELSE 0 END, e.id ASC")
    List<Exercise> findVisibleByNameAndTrackingType(@Param("accountId") Long accountId,
                                                    @Param("name") String name,
                                                    @Param("trackingType") String trackingType);

    // ── The private-members catalogue ───────────────────────────────────────────────────────────
    //
    // ⚠️ THIS IS WHERE THE PRO PRIVACY CLAIM IS EITHER TRUE OR QUIETLY FALSE. Exercises are
    // ACCOUNT-scoped, not person-scoped, so without this a client who created "Rehab -- post-op
    // shoulder" would have it appear in every other client's picker. No workout data leaks that
    // way, but an exercise NAME is free text a person typed about themselves, and a roster of
    // strangers is not a family.
    //
    // What a member sees in an account where members_see_everyone is off:
    //   - every global row (account IS NULL) -- the preloaded catalogue, nobody's private business;
    //   - rows they created themselves;
    //   - rows created by whoever RUNS the account (OWNER or MANAGER), because those are the
    //     practice's own catalogue and the whole point of a trainer building one;
    //   - rows with NO creator stamp.
    //
    // That last one is visible rather than hidden, deliberately. A null stamp means nobody in this
    // account is recorded as having made the row (V67 names the three ways it happens), and every
    // one of them predates the account being Pro -- so hiding them would make an existing
    // catalogue mysteriously incomplete to defend privacy that was never at stake. Note this is the
    // OPPOSITE polarity to AccountAccess.mayEditSharedResource, which fails CLOSED on a null: that
    // question is "may I change somebody else's row" and this one is "may I see a row nobody
    // claims", and the safe answer differs.
    @Query("SELECT e FROM Exercise e WHERE e.deleted = false AND ("
            + "e.account IS NULL OR (e.account.id = :accountId AND ("
            + "e.createdByUserId IS NULL OR e.createdByUserId = :viewerUserId "
            + "OR e.createdByUserId IN (SELECT m.user.id FROM AccountMembership m "
            + "WHERE m.account.id = :accountId AND m.accountRole <> com.worktrac.backend.membership.AccountRole.MEMBER)"
            + "))) ORDER BY e.name ASC")
    List<Exercise> findVisibleToMember(@Param("accountId") Long accountId,
                                       @Param("viewerUserId") Long viewerUserId);

    // The dedup lookup, scoped the same way. ⚠️ MUST mirror findVisibleToMember exactly: resolving
    // a create against a row the caller cannot see tells them "you already have this" about
    // something that then never appears in their picker -- which is worse than the duplicate row it
    // was avoiding. Same ORDER BY as the account-wide version, for the same reason.
    @Query("SELECT e FROM Exercise e WHERE e.deleted = false AND ("
            + "e.account IS NULL OR (e.account.id = :accountId AND ("
            + "e.createdByUserId IS NULL OR e.createdByUserId = :viewerUserId "
            + "OR e.createdByUserId IN (SELECT m.user.id FROM AccountMembership m "
            + "WHERE m.account.id = :accountId AND m.accountRole <> com.worktrac.backend.membership.AccountRole.MEMBER)"
            + "))) AND LOWER(e.name) = LOWER(:name) AND e.trackingType = :trackingType "
            + "ORDER BY CASE WHEN e.account IS NULL THEN 1 ELSE 0 END, e.id ASC")
    List<Exercise> findVisibleToMemberByNameAndTrackingType(@Param("accountId") Long accountId,
                                                            @Param("viewerUserId") Long viewerUserId,
                                                            @Param("name") String name,
                                                            @Param("trackingType") String trackingType);

    void deleteByAccount_Id(Long accountId);

    // Genuine single-statement bulk delete for TestDataCleanupService -- see
    // PersonRepository.deleteByAccountIdIn's comment for why this is safe and preferred over the
    // derived, entity-at-a-time deleteByAccount_Id above for that specific caller.
    @Modifying
    @Query("DELETE FROM Exercise e WHERE e.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);
}
