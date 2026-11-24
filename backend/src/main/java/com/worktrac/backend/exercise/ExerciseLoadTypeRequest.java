package com.worktrac.backend.exercise;

// PUT /api/exercises/{id}/load-type -- 'external' or 'bodyweight' for one of the household's own
// exercises. An unknown value is read as 'external' (Exercise.normalizeLoadType); the only refusals
// are about WHO may change it, never about what was sent.
public record ExerciseLoadTypeRequest(String loadType) {
}
