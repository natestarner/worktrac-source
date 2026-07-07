package com.worktrac.backend.workoutsession;

import java.time.Instant;

public record WorkoutSessionDto(Long id, Instant startedAt, Instant endedAt, boolean manual) {

    public static WorkoutSessionDto from(WorkoutSession session) {
        return new WorkoutSessionDto(session.getId(), session.getStartedAt(), session.getEndedAt(), session.isManual());
    }
}
