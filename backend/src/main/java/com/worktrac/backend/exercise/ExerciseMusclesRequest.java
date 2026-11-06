package com.worktrac.backend.exercise;

import java.util.List;

// PUT /api/exercises/{id}/muscles -- the whole set of muscles for one of the household's own
// exercises, replacing what was there. Null lists are empty lists; unknown codes are dropped
// (ExerciseMuscleWriter), so the only refusals are about WHO may edit, never about WHAT was sent.
public record ExerciseMusclesRequest(List<String> primaryMuscles, List<String> secondaryMuscles) {
}
