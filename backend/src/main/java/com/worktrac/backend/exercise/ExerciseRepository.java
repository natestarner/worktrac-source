package com.worktrac.backend.exercise;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ExerciseRepository extends JpaRepository<Exercise, Long> {

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

    void deleteByAccount_Id(Long accountId);

    // Genuine single-statement bulk delete for TestDataCleanupService -- see
    // PersonRepository.deleteByAccountIdIn's comment for why this is safe and preferred over the
    // derived, entity-at-a-time deleteByAccount_Id above for that specific caller.
    @Modifying
    @Query("DELETE FROM Exercise e WHERE e.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);
}
