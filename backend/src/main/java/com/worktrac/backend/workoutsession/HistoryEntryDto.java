package com.worktrac.backend.workoutsession;

import com.worktrac.backend.stats.SetSummaryDto;

import java.util.List;

public record HistoryEntryDto(Long exerciseId, String exerciseName, List<SetSummaryDto> sets) {
}
