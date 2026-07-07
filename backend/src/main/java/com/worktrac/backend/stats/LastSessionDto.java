package com.worktrac.backend.stats;

import java.time.Instant;
import java.util.List;

public record LastSessionDto(Long sessionId, Instant startedAt, List<SetSummaryDto> sets) {
}
