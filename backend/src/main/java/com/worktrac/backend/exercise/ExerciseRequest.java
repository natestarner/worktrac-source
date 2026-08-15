package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;

// Adding/renaming an exercise. "Add your own" needs only a name; the person tags it afterward
// from the household's shared tag vocabulary, and adds setup fields per-person from the
// exercise's Customize screen.
//
// idempotencyKey is optional and only meaningful on create: a client-generated key so an
// offline-created exercise whose create is retried/replayed dedupes to the same row instead of
// duplicating (see ExerciseService.add). Absent/blank => no dedup. Ignored on rename.
//
// trackingType is likewise create-only ("is this measured in reps or in seconds held?"), absent =>
// 'strength'. It is ignored on rename because Exercise deliberately has no setter for it: flipping
// it would reinterpret every set already logged against the exercise.
public record ExerciseRequest(
        @NotBlank String name,
        String idempotencyKey,
        String trackingType
) {
    // Kept so existing callers and tests that only supply a name (and optionally a key) still
    // compile -- the two-arg shape was the whole record until endurance exercises were added.
    public ExerciseRequest(String name, String idempotencyKey) {
        this(name, idempotencyKey, null);
    }

    public String trackingTypeOrDefault() {
        return trackingType == null || trackingType.isBlank()
                ? Exercise.TRACKING_TYPE_STRENGTH
                : trackingType;
    }
}
