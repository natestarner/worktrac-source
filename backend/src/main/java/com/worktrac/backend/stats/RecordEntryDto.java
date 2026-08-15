package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// A single all-time best, with enough context to render "225 lb x 5 on Mar 3" whatever the record
// is measuring. valueLb is the metric being maximized (heaviest weight, set volume, session
// volume, ...); weightLb/reps/durationSeconds describe the set behind it, and are null for a
// session-level record where no single set is the answer.
//
// valueLb is NOT always pounds -- it is whatever that record maximizes, so it is a rep count on
// mostReps and a second count on longestHold. The consumer knows which record it asked for.
public record RecordEntryDto(BigDecimal valueLb, BigDecimal weightLb, Integer reps, Integer durationSeconds,
                              LocalDate date) {
}
