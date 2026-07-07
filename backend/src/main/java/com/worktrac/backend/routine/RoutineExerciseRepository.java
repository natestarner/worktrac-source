package com.worktrac.backend.routine;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RoutineExerciseRepository extends JpaRepository<RoutineExercise, Long> {

    // Used when forking a system exercise: re-points this account's own routine
    // entries from the shared original to the account-owned fork.
    List<RoutineExercise> findByExercise_IdAndRoutine_Person_IdIn(Long exerciseId, List<Long> personIds);
}
