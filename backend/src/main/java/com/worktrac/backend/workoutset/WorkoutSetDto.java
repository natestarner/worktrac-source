package com.worktrac.backend.workoutset;

import java.math.BigDecimal;
import java.time.Instant;

// restSeconds is null unless the set was logged live and wasn't the first of its
// exercise in the session -- see WorkoutSet.java for the full rule.
//
// durationSeconds is null for a strength set and populated (with reps 0) for a hold.
public record WorkoutSetDto(Long id, Long sessionId, Long exerciseId, BigDecimal weight, int reps,
                             Integer durationSeconds, String unit, Instant createdAt, Integer restSeconds) {

    public static WorkoutSetDto from(WorkoutSet set) {
        return new WorkoutSetDto(set.getId(), set.getSession().getId(), set.getExercise().getId(),
                set.getWeight(), set.getReps(), set.getDurationSeconds(), set.getUnit(), set.getCreatedAt(),
                set.getRestSeconds());
    }
}
