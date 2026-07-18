package com.worktrac.backend.sessionexercisenote;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record LiveExerciseNoteRequest(
        @NotNull Long exerciseId,
        @Size(max = 1000, message = "must be 1000 characters or fewer") String note
) {
}
