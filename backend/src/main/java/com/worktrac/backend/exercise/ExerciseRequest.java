package com.worktrac.backend.exercise;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record ExerciseRequest(
        @NotBlank String name,
        @NotNull Long categoryId,
        List<String> setupFieldNames
) {
    public List<String> setupFieldNamesOrEmpty() {
        return setupFieldNames == null ? List.of() : setupFieldNames;
    }
}
