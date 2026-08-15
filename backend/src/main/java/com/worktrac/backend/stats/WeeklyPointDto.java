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
//
// totalHoldSeconds is the same week's time under tension -- every duration-tracked set summed. A
// hold contributes 0 to volume and 0 to reps (it carries reps 0), so without this a week of plank
// and wall-sit work would read as no work at all on every chart but set count.
public record WeeklyPointDto(LocalDate weekStart, int workoutCount, BigDecimal totalVolumeLb,
                              int totalSets, int totalReps, int totalHoldSeconds) {
}
