package com.worktrac.backend.stats;

import java.math.BigDecimal;

public record SetSummaryDto(BigDecimal weight, int reps, String unit) {
}
