package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// weekStart is always a Monday. totalVolumeLb is every set's weight x reps for that week,
// converted to lb (same cross-unit comparison approach as PR ranking) so the chart isn't
// skewed by a mid-history unit switch.
//
// totalSets/totalReps are unit-free counts covering the same week. They exist because volume in lb
// is dominated by whichever lifts happen to be heavy -- a squat day outweighs a whole week of
// accessory work -- so set count is the better read on how much training actually happened.
public record WeeklyPointDto(LocalDate weekStart, int workoutCount, BigDecimal totalVolumeLb,
                              int totalSets, int totalReps) {
}
