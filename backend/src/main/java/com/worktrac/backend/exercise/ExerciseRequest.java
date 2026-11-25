package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

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
//
// primaryMuscles / secondaryMuscles are create-only and OPTIONAL: muscle codes (V91) the person
// picked for their own exercise. ⚠️ Never a reason to refuse: this is a durable write, so unknown
// codes (a newer client, a typo) are dropped rather than answered with a 400 -- see
// ExerciseMuscleWriter. Ignored on rename; muscles change through PUT /{id}/muscles.
//
// loadType (V107) is create-only and OPTIONAL: 'external' (a weight is expected) or 'bodyweight'
// (weight is added on top of you). Absent -- every client before 1.4, and every create queued
// offline by one -- means 'external'; an unknown value is read as 'external' too, never refused
// (Exercise.normalizeLoadType). Ignored on rename; it changes through PUT /{id}/load-type.
public record ExerciseRequest(
        @NotBlank @Size(max = 200, message = "must be 200 characters or fewer") String name,
        String idempotencyKey,
        String trackingType,
        List<String> primaryMuscles,
        List<String> secondaryMuscles,
        String loadType
) {
    // Kept so existing callers and tests that only supply a name (and optionally a key) still
    // compile -- the two-arg shape was the whole record until endurance exercises were added.
    public ExerciseRequest(String name, String idempotencyKey) {
        this(name, idempotencyKey, null, null, null, null);
    }

    public ExerciseRequest(String name, String idempotencyKey, String trackingType) {
        this(name, idempotencyKey, trackingType, null, null, null);
    }

    public String trackingTypeOrDefault() {
        return trackingType == null || trackingType.isBlank()
                ? Exercise.TRACKING_TYPE_STRENGTH
                : trackingType;
    }
}
