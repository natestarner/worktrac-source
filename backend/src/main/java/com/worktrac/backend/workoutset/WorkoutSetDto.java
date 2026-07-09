package com.worktrac.backend.workoutset;

import java.math.BigDecimal;
import java.time.Instant;

// restSeconds is null unless the set was logged live and wasn't the first of its
// exercise in the session -- see WorkoutSet.java for the full rule.
public record WorkoutSetDto(Long id, Long sessionId, Long exerciseId, BigDecimal weight, int reps, String unit,
                             Instant createdAt, Integer restSeconds) {

    public static WorkoutSetDto from(WorkoutSet set) {
        return new WorkoutSetDto(set.getId(), set.getSession().getId(), set.getExercise().getId(),
                set.getWeight(), set.getReps(), set.getUnit(), set.getCreatedAt(), set.getRestSeconds());
    }
}
