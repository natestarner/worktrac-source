package com.worktrac.backend.sessionexercisenote;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SessionExerciseNoteRepository extends JpaRepository<SessionExerciseNote, Long> {

    Optional<SessionExerciseNote> findBySession_IdAndExercise_Id(Long sessionId, Long exerciseId);

    // Bulk lookup for History: one query for every note across a person's sessions,
    // grouped in memory by the caller -- mirrors how WorkoutSessionService.getHistory
    // already loads every WorkoutSet once rather than querying per session/exercise.
    List<SessionExerciseNote> findBySession_IdIn(List<Long> sessionIds);
}
