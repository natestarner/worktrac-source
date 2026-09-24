package com.worktrac.backend.sessionexercisenote;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SessionExerciseNoteRepository extends JpaRepository<SessionExerciseNote, Long> {

    Optional<SessionExerciseNote> findBySession_IdAndExercise_Id(Long sessionId, Long exerciseId);

    // Bulk lookup for History and CSV export: one query for every note across a person's sessions,
    // grouped in memory by the caller -- mirrors how WorkoutSessionService.getHistory already loads
    // every WorkoutSet once rather than querying per session/exercise.
    //
    // Keyed on the PERSON, never on a list of session ids. It was `findBySession_IdIn(sessionIds)`,
    // which binds one parameter per session, and SQL Server refuses any statement with more than
    // 2,100 -- so History and export both failed outright (503) for anyone past ~2,100 sessions,
    // about 5.75 years of daily training. Guarded by HistoryScaleTest.
    List<SessionExerciseNote> findBySession_Person_Id(Long personId);

    // Scoped by owner as well as batch -- see ImportUndoService. The note reaches its person
    // through its session, since session_exercise_notes carries no person_id of its own.
    @Modifying
    @Query("DELETE FROM SessionExerciseNote n WHERE n.importBatchId = :batchId "
            + "AND n.session.person.id = :personId")
    int deleteByImportBatchIdForPerson(@Param("batchId") Long batchId, @Param("personId") Long personId);

}
