package com.worktrac.backend.exercise;

// Add uses name (value optional); update may send either. Validation is done in the service so
// a value-only update (name omitted) isn't rejected.
public record PersonExerciseFieldRequest(String name, String value) {
}
