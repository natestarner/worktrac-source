package com.worktrac.backend.exercise;

import java.util.List;

public record ExerciseDto(
        Long id,
        String name,
        Long categoryId,
        String categoryName,
        String trackingType,
        boolean isGlobal,
        List<ExerciseSetupFieldDto> setupFields
) {
    public static ExerciseDto from(Exercise exercise) {
        return new ExerciseDto(
                exercise.getId(),
                exercise.getName(),
                exercise.getCategory().getId(),
                exercise.getCategory().getName(),
                exercise.getTrackingType(),
                exercise.isGlobal(),
                exercise.getSetupFields().stream().map(ExerciseSetupFieldDto::from).toList());
    }
}
