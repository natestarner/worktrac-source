package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

// Adding/renaming an exercise. categoryId is optional now that categories are per-person --
// "add your own" needs only a name; the person can file it into one of their own categories
// afterward (or leave it uncategorized).
public record ExerciseRequest(
        @NotBlank String name,
        Long categoryId,
        List<String> setupFieldNames
) {
    public List<String> setupFieldNamesOrEmpty() {
        return setupFieldNames == null ? List.of() : setupFieldNames;
    }
}
