package com.worktrac.backend.sessionexercisenote;

import jakarta.validation.constraints.Size;

public record ExerciseNoteRequest(
        @Size(max = 1000, message = "must be 1000 characters or fewer") String note
) {
}
