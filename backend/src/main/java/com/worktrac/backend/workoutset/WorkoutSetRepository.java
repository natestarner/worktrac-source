package com.worktrac.backend.workoutset;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

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

    List<WorkoutSet> findByPerson_IdOrderByCreatedAtAsc(Long personId);

    Optional<WorkoutSet> findByIdAndPerson_Id(Long id, Long personId);

    // Defense-in-depth: confirms a set belongs to the caller's account by walking
    // set -> session -> person -> account, without trusting a client-supplied personId.
    Optional<WorkoutSet> findByIdAndSession_Person_Account_Id(Long id, Long accountId);

    boolean existsByExercise_Id(Long exerciseId);
}
