package com.worktrac.backend.routine;

import java.util.List;

public record RoutineDto(Long id, String name, List<RoutineExerciseDto> exercises) {

    public static RoutineDto from(Routine routine) {
        return new RoutineDto(
                routine.getId(),
                routine.getName(),
                routine.getExercises().stream().map(RoutineExerciseDto::from).toList());
    }
}
