package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.Instant;

public record BestDto(BigDecimal weight, int reps, String unit, BigDecimal est1rm, Instant sessionStartedAt) {
}
