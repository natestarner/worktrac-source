package com.worktrac.backend.workoutsession;

import com.worktrac.backend.stats.SetSummaryDto;

import java.util.List;

// note is the session note (if any) left on this exercise for this session -- see
// com.worktrac.backend.sessionexercisenote -- so History can show what was written for a
// given past workout the same way the "Last time" card does.
public record HistoryEntryDto(Long exerciseId, String exerciseName, List<SetSummaryDto> sets, String note) {
}
