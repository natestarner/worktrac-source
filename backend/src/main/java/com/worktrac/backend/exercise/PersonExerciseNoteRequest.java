package com.worktrac.backend.exercise;

import jakarta.validation.constraints.Size;

// A blank/absent note clears the standing per-person note for this exercise.
public record PersonExerciseNoteRequest(
        @Size(max = 1000, message = "must be 1000 characters or fewer") String note
) {
}
