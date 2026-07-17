package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;

// Adding/renaming an exercise. "Add your own" needs only a name; the person tags it afterward
// from the household's shared tag vocabulary, and adds setup fields per-person from the
// exercise's Customize screen.
public record ExerciseRequest(
        @NotBlank String name
) {
}
