package com.worktrac.backend.exercise;

// One row of a person's Log picker list -- an exercise they've favorited or logged, carrying
// their personalization (favorite flag + which of their own categories it's filed under).
// A person's own setup fields are fetched separately (GET .../custom-fields) since they carry
// per-person values.
public record PersonExerciseDto(
        Long id,
        String name,
        String trackingType,
        boolean isGlobal,
        boolean isFavorite,
        Long personCategoryId,
        String personCategoryName
) {
    public static PersonExerciseDto of(Exercise exercise, PersonExercise personExercise) {
        boolean favorite = personExercise != null && personExercise.isFavorite();
        Long categoryId = null;
        String categoryName = null;
        if (personExercise != null && personExercise.getCategory() != null) {
            categoryId = personExercise.getCategory().getId();
            categoryName = personExercise.getCategory().getName();
        }
        return new PersonExerciseDto(
                exercise.getId(),
                exercise.getName(),
                exercise.getTrackingType(),
                exercise.isGlobal(),
                favorite,
                categoryId,
                categoryName);
    }
}
