package com.worktrac.backend.exercise;

import jakarta.validation.constraints.Size;

// Add uses name (value optional); update may send either. Blank-vs-absent is still resolved in the
// service so a value-only update (name omitted) isn't rejected -- these caps only bound LENGTH,
// matching person_exercise_fields.name NVARCHAR(100) and .value NVARCHAR(200).
public record PersonExerciseFieldRequest(
        @Size(max = 100, message = "must be 100 characters or fewer") String name,
        @Size(max = 200, message = "must be 200 characters or fewer") String value) {
}
