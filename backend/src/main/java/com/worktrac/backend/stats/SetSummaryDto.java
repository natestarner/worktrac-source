package com.worktrac.backend.stats;

import java.math.BigDecimal;

// durationSeconds is non-null (and reps 0) for a set of a duration-tracked exercise -- see
// WorkoutSet. Consumers format on that, never on reps == 0, which is also a legal strength value.
public record SetSummaryDto(BigDecimal weight, int reps, Integer durationSeconds, String unit) {
}
