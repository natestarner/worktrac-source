package com.worktrac.backend.workoutset;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;

public interface WorkoutSetRepository extends JpaRepository<WorkoutSet, Long> {

    List<WorkoutSet> findByPerson_IdAndExercise_Id(Long personId, Long exerciseId);

    // The "has a logged set" half of a person's Log picker: every exercise they've ever
    // logged shows up automatically, alongside their favorites.
    @Query("SELECT DISTINCT ws.exercise.id FROM WorkoutSet ws WHERE ws.person.id = :personId")
    List<Long> findDistinctExerciseIdsByPerson(@Param("personId") Long personId);

    List<WorkoutSet> findBySession_Id(Long sessionId);

    List<WorkoutSet> findBySession_IdAndExercise_IdOrderByCreatedAtAsc(Long sessionId, Long exerciseId);

    // Used to compute rest_seconds for a newly-logged live set: the gap between "now"
    // and this row's created_at. Only ever called from the live-session path -- see
    // WorkoutSetService.logLiveSet.
    Optional<WorkoutSet> findFirstBySession_IdAndExercise_IdOrderByCreatedAtDesc(Long sessionId, Long exerciseId);

    // Ordered by id as well as created_at, so the order is TOTAL rather than merely mostly-sorted.
    // Two sets can share a created_at -- the column is a datetime2, but a CSV round trip only
    // carries seconds, so an imported pair genuinely lands on the same instant -- and without a
    // tiebreaker SQL Server is free to return those two in either order. That made an export
    // non-deterministic for exactly the data an import produces.
    List<WorkoutSet> findByPerson_IdOrderByCreatedAtAscIdAsc(Long personId);

    Optional<WorkoutSet> findByIdAndPerson_Id(Long id, Long personId);

    // Defense-in-depth: confirms a set belongs to the caller's account by walking
    // set -> session -> person -> account, without trusting a client-supplied personId.
    Optional<WorkoutSet> findByIdAndSession_Person_Account_Id(Long id, Long accountId);

    // Idempotency: an already-committed set for this client key. Account-scoped so a key can only
    // ever match the caller's own set.
    Optional<WorkoutSet> findByClientKeyAndSession_Person_Account_Id(String clientKey, Long accountId);

    boolean existsByExercise_Id(Long exerciseId);

    // Admin-only: [accountId, count] pairs across ALL accounts, consumed only by AdminService.
    @Query("SELECT ws.session.person.account.id, COUNT(ws) FROM WorkoutSet ws GROUP BY ws.session.person.account.id")
    List<Object[]> countGroupedByAccount();

    // Undo, scoped by BOTH the batch and its owner. The person predicate is not redundant defence
    // in depth for its own sake: "every set stamped with this batch belongs to this person" is an
    // app-layer invariant the schema does not enforce, and this is a delete. See ImportUndoService.
    @Modifying
    @Query("DELETE FROM WorkoutSet s WHERE s.importBatchId = :batchId AND s.person.id = :personId")
    int deleteByImportBatchIdForPerson(@Param("batchId") Long batchId, @Param("personId") Long personId);

}
