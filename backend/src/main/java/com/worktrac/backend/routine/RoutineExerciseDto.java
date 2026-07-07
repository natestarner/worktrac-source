package com.worktrac.backend.routine;

public record RoutineExerciseDto(Long exerciseId, String exerciseName) {

    public static RoutineExerciseDto from(RoutineExercise routineExercise) {
        return new RoutineExerciseDto(routineExercise.getExercise().getId(), routineExercise.getExercise().getName());
    }
}
