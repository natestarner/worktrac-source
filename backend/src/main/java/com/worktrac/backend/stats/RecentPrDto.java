package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// A set that beat this person's previous best for its exercise, within the recent window.
// Weights are normalized to lb like every other trend value, so the client converts once.
public record RecentPrDto(LocalDate date, Long exerciseId, String exerciseName,
                           BigDecimal weightLb, int reps, BigDecimal est1rmLb) {
}
