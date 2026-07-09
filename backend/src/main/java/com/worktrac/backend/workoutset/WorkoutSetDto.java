package com.worktrac.backend.workoutset;

import java.math.BigDecimal;
import java.time.Instant;

public record WorkoutSetDto(Long id, Long sessionId, Long exerciseId, BigDecimal weight, int reps, String unit,
                             Instant createdAt) {

    public static WorkoutSetDto from(WorkoutSet set) {
        return new WorkoutSetDto(set.getId(), set.getSession().getId(), set.getExercise().getId(),
                set.getWeight(), set.getReps(), set.getUnit(), set.getCreatedAt());
    }
}
