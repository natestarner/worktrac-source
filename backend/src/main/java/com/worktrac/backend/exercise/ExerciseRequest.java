package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;

// Adding/renaming an exercise. "Add your own" needs only a name; the person tags it afterward
// from the household's shared tag vocabulary, and adds setup fields per-person from the
// exercise's Customize screen.
//
// idempotencyKey is optional and only meaningful on create: a client-generated key so an
// offline-created exercise whose create is retried/replayed dedupes to the same row instead of
// duplicating (see ExerciseService.add). Absent/blank => no dedup. Ignored on rename.
public record ExerciseRequest(
        @NotBlank String name,
        String idempotencyKey
) {
}
