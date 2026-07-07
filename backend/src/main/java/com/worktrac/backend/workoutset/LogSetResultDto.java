package com.worktrac.backend.workoutset;

import com.worktrac.backend.stats.BestDto;
import com.worktrac.backend.workoutsession.WorkoutSessionDto;

public record LogSetResultDto(WorkoutSetDto set, WorkoutSessionDto session, boolean isPR, BestDto best) {
}
