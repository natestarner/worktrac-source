package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;

// Adding/renaming an exercise. categoryId is optional now that categories are per-person --
// "add your own" needs only a name; the person can file it into one of their own categories
// afterward (or leave it uncategorized). Setup fields are added per-person afterward, not at
// create time.
public record ExerciseRequest(
        @NotBlank String name,
        Long categoryId
) {
}
