package com.worktrac.backend.exercise;

// The catalog/search shape used for exercise search. Tagging/favoriting is per-person (see
// PersonExerciseDto); this is just the searchable pool.
//
// The last three fields are ExerciseAttribution flattened -- who added this row and whether the
// CURRENT login may rename it. Flattened rather than nested so the client reads `exercise.renamable`
// directly, and carried on THIS dto as well as PersonExerciseDto because LogTab falls back to the
// catalog row for an exercise the person has never favorited or logged -- which is exactly how a
// member reaches somebody else's exercise.
public record ExerciseDto(
        Long id,
        String name,
        String trackingType,
        boolean isGlobal,
        String createdByName,
        boolean createdByYou,
        boolean renamable
) {
    public static ExerciseDto from(Exercise exercise, ExerciseAttribution attribution) {
        return new ExerciseDto(
                exercise.getId(),
                exercise.getName(),
                exercise.getTrackingType(),
                exercise.isGlobal(),
                attribution.createdByName(),
                attribution.createdByYou(),
                attribution.renamable());
    }
}
