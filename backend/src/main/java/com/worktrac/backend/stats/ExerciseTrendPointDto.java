package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// One point per session that included this exercise. isPr marks a new best-ever est. 1RM as of
// that session, consistent with how WorkoutSetService flags PRs at log time.
//
// weightLb/reps/est1rmLb describe that session's best set BY ESTIMATED 1RM -- don't repurpose
// them, the tooltip and the session list below the chart both read them as exactly that.
//
// The remaining fields are the same session summarized other ways, so the client's metric switcher
// can plot five different charts from one fetch instead of one request per metric:
//   heaviestWeightLb/heaviestWeightReps - the top weight touched (which is NOT always the best-1RM
//     set: 225x1 outweighs 185x8 on the bar but loses on estimated 1RM)
//   bestSetVolumeLb - the single best weight x reps set
//   sessionVolumeLb - every set for this exercise that session, summed
//   totalReps/setCount - unit-free work done
public record ExerciseTrendPointDto(LocalDate date, Long sessionId, BigDecimal weightLb, int reps,
                                     BigDecimal est1rmLb, boolean isPr,
                                     BigDecimal heaviestWeightLb, int heaviestWeightReps,
                                     BigDecimal bestSetVolumeLb, BigDecimal sessionVolumeLb,
                                     int totalReps, int setCount) {
}
