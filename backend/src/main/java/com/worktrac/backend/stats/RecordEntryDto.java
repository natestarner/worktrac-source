package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// A single all-time best, with enough context to render "225 lb x 5 on Mar 3" whatever the record
// is measuring. valueLb is the metric being maximized (heaviest weight, set volume, session
// volume, ...); weightLb/reps describe the set behind it, and are null for a session-level record
// where no single set is the answer.
public record RecordEntryDto(BigDecimal valueLb, BigDecimal weightLb, Integer reps, LocalDate date) {
}
