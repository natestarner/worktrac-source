package com.worktrac.backend.csvimport;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ImportBatchRepository extends JpaRepository<ImportBatch, Long> {

    List<ImportBatch> findByPerson_IdOrderByCreatedAtDesc(Long personId);

    // Person-scoped lookup, never findById: a batch is only ever addressed through the person
    // whose data it touched, so "someone else's batch id" is indistinguishable from "no such
    // batch" -- the same shape as PersonService.requireOwnedPerson.
    Optional<ImportBatch> findByIdAndPerson_Id(Long id, Long personId);

    // The bulk queries below back ImportBatchCleanup; see that class for why the detaches have to
    // run before the delete. Written as single statements rather than derived deleteBy... methods
    // for the reason spelled out in TestDataCleanupService: a derived delete loads and removes
    // every entity one at a time, and that is what once took account cleanup past the frontend's
    // request timeout.
    @Modifying
    @Query("UPDATE WorkoutSet s SET s.importBatchId = NULL "
            + "WHERE s.importBatchId IS NOT NULL AND s.person.account.id IN :accountIds")
    void detachSetsForAccounts(@Param("accountIds") List<Long> accountIds);

    @Modifying
    @Query("UPDATE WorkoutSession s SET s.importBatchId = NULL "
            + "WHERE s.importBatchId IS NOT NULL AND s.person.account.id IN :accountIds")
    void detachSessionsForAccounts(@Param("accountIds") List<Long> accountIds);

    @Modifying
    @Query("UPDATE SessionExerciseNote n SET n.importBatchId = NULL "
            + "WHERE n.importBatchId IS NOT NULL AND n.session.person.account.id IN :accountIds")
    void detachNotesForAccounts(@Param("accountIds") List<Long> accountIds);

    @Modifying
    @Query("DELETE FROM ImportBatch b WHERE b.person.account.id IN :accountIds")
    void deleteByAccountIdIn(@Param("accountIds") List<Long> accountIds);
}
