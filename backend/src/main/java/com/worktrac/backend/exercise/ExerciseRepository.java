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

    void deleteByAccount_Id(Long accountId);

    // Genuine single-statement bulk delete for TestDataCleanupService -- see
    // PersonRepository.deleteByAccountIdIn's comment for why this is safe and preferred over the
    // derived, entity-at-a-time deleteByAccount_Id above for that specific caller.
    @Modifying
    @Query("DELETE FROM Exercise e WHERE e.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);
}
