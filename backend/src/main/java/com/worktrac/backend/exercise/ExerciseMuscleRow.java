package com.worktrac.backend.exercise;

/** One exercise_muscles row, as read by ExerciseRepository's native muscle queries. */
public interface ExerciseMuscleRow {
    Long getExerciseId();

    String getMuscleCode();

    String getRole();
}
