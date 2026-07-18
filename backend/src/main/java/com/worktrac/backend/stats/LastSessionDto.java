package com.worktrac.backend.stats;

import java.time.Instant;
import java.util.List;

// note is the session note (if any) left on this exercise for this session -- see
// com.worktrac.backend.sessionexercisenote -- surfaced so the "Last time" card can show
// what was written the previous time this exercise was done.
public record LastSessionDto(Long sessionId, Instant startedAt, List<SetSummaryDto> sets, String note) {
}
