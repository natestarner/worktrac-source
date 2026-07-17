package com.worktrac.backend.exercise;

import java.util.List;

// The catalog/search shape used for exercise search. Tagging/favoriting is per-person (see
// PersonExerciseDto); this is just the searchable pool.
public record ExerciseDto(
        Long id,
        String name,
        String trackingType,
        boolean isGlobal,
        List<ExerciseSetupFieldDto> setupFields
) {
    public static ExerciseDto from(Exercise exercise) {
        return new ExerciseDto(
                exercise.getId(),
                exercise.getName(),
                exercise.getTrackingType(),
                exercise.isGlobal(),
                exercise.getSetupFields().stream().map(ExerciseSetupFieldDto::from).toList());
    }
}
