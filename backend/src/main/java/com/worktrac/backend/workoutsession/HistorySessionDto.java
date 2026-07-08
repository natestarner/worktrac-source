package com.worktrac.backend.workoutsession;

import java.time.Instant;
import java.util.List;

public record HistorySessionDto(Long id, Instant startedAt, Instant endedAt, boolean manual,
                                 List<HistoryEntryDto> entries) {
}
