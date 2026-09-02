package com.worktrac.backend.workoutsession;

import java.time.Instant;

// The aggregate WorkoutSessionRepository#summarizeHiddenBefore projects into. Separate from
// HistoryWindowDto because this is the raw database answer ("how much is behind this floor") while
// the DTO is what the browser is told; keeping them apart is what lets the Pro case return
// HistoryWindowDto.unclamped() without running a query at all.
//
// hiddenSessions is boxed to match what COUNT() projects, and earliestHiddenAt is null when the
// count is zero (MIN over no rows).
public record HiddenHistorySummary(Long hiddenSessions, Instant earliestHiddenAt) {
}
