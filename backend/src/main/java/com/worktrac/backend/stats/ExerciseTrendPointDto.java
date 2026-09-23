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
//   sessionVolume/volumeKind - every set for this exercise that session, summed in the exercise's
//     own volume measure (SessionVolume: "load" = pounds, "reps", "seconds"). The kind is the
//     exercise's, so it is the same on every point; it rides on each one so the chart never plots
//     a number without its unit.
//   totalReps/setCount - unit-free work done
//
// For a DURATION-tracked exercise every weight-derived field above is 0 by construction (reps is 0
// on a hold, so weight x reps is 0), and the fields that carry the actual signal are
// bestHoldSeconds/totalHoldSeconds -- and sessionVolume, which for a hold is its total seconds. est1rmLb still holds the value isPr was decided on -- which for
// a hold is the duration -- so don't render it as a weight without checking the exercise; that is
// the same caveat it already carried for bodyweight sets, where it is a rep count.
public record ExerciseTrendPointDto(LocalDate date, Long sessionId, BigDecimal weightLb, int reps,
                                     BigDecimal est1rmLb, boolean isPr,
                                     BigDecimal heaviestWeightLb, int heaviestWeightReps,
                                     BigDecimal bestSetVolumeLb, BigDecimal sessionVolume, String volumeKind,
                                     int totalReps, int setCount,
                                     Integer bestHoldSeconds, int totalHoldSeconds) {
}
