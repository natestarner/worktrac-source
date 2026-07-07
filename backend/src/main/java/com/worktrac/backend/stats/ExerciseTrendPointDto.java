package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// One point per session that included this exercise -- the session's best set (by
// estimated 1RM), converted to lb. isPr marks a new best-ever est. 1RM as of that session,
// consistent with how WorkoutSetService flags PRs at log time.
public record ExerciseTrendPointDto(LocalDate date, Long sessionId, BigDecimal weightLb, int reps,
                                     BigDecimal est1rmLb, boolean isPr) {
}
