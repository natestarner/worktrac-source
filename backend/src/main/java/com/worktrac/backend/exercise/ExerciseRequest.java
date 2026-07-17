package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

// Adding/renaming an exercise. "Add your own" needs only a name; the person tags it afterward
// from the household's shared tag vocabulary (or leaves it untagged).
public record ExerciseRequest(
        @NotBlank String name,
        List<String> setupFieldNames
) {
    public List<String> setupFieldNamesOrEmpty() {
        return setupFieldNames == null ? List.of() : setupFieldNames;
    }
}
