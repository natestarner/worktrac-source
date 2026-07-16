package com.worktrac.backend.exercise;

import java.util.List;

// The catalog/search shape. Categories are now per-person (see PersonExerciseDto), so
// categoryId/categoryName are legacy and may be null on exercises created after the rethink;
// the UI no longer groups the catalog by them.
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
                exercise.getCategory() == null ? null : exercise.getCategory().getId(),
                exercise.getCategory() == null ? null : exercise.getCategory().getName(),
                exercise.getTrackingType(),
                exercise.isGlobal(),
                exercise.getSetupFields().stream().map(ExerciseSetupFieldDto::from).toList());
    }
}
