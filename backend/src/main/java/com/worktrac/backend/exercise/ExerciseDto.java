package com.worktrac.backend.exercise;

import java.util.List;

// The catalog/search shape used for exercise search. Tagging/favoriting is per-person (see
// PersonExerciseDto); this is just the searchable pool.
//
// createdByName / createdByYou / renamable are ExerciseAttribution flattened -- who added this row
// and whether the CURRENT login may rename it. Flattened rather than nested so the client reads
// `exercise.renamable` directly, and carried on THIS dto as well as PersonExerciseDto because LogTab
// falls back to the catalog row for an exercise the person has never favorited or logged -- which
// is exactly how a member reaches somebody else's exercise.
//
// primaryMuscles / secondaryMuscles are muscle codes (V91) -- "muscles worked", a fact about the
// movement, not a person's personalization. They live on the catalog row only: the client looks an
// exercise up here by id, so there is one source for them, and the catalog is already cached for
// offline use. Empty lists for an exercise nobody has described; an installed client that predates
// these fields ignores them, and a cached catalog that predates them simply lacks them, so the
// client must treat absent as empty (resilience.md, axis D).
public record ExerciseDto(
        Long id,
        String name,
        String trackingType,
        boolean isGlobal,
        String createdByName,
        boolean createdByYou,
        boolean renamable,
        List<String> primaryMuscles,
        List<String> secondaryMuscles
) {
    public static ExerciseDto from(Exercise exercise, ExerciseAttribution attribution, ExerciseMuscles muscles) {
        return new ExerciseDto(
                exercise.getId(),
                exercise.getName(),
                exercise.getTrackingType(),
                exercise.isGlobal(),
                attribution.createdByName(),
                attribution.createdByYou(),
                attribution.renamable(),
                muscles.primary(),
                muscles.secondary());
    }
}
