package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// weekStart is always a Monday. totalVolumeLb is every set's weight x reps for that week,
// converted to lb (same cross-unit comparison approach as PR ranking) so the chart isn't
// skewed by a mid-history unit switch.
public record WeeklyPointDto(LocalDate weekStart, int workoutCount, BigDecimal totalVolumeLb) {
}
