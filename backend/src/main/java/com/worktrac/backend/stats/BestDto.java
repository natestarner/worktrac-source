package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.Instant;

// est1rm is null for a hold: Epley over 0 reps is meaningless, and presenting seconds as a weight
// is the "rep count wearing a costume" mistake the weight-0 branch exists to avoid. For a hold the
// record IS durationSeconds.
public record BestDto(BigDecimal weight, int reps, Integer durationSeconds, String unit, BigDecimal est1rm,
                       Instant sessionStartedAt) {
}
