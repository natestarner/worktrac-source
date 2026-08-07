package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.util.List;

// All-time records for one person + exercise, deliberately NOT scoped to the trends range toggle:
// a record is a record regardless of which window you're looking at, and keeping it range-free
// means the client caches it once instead of refetching on every 4wk/12wk/All click.
//
// bodyweightOnly is true when every set ever logged for this exercise had weight 0 (pull-ups,
// push-ups). Every weight-based record below is then meaningless -- the rep-max table would be a
// column of zeros -- so the client renders a rep-focused view instead. This is the same weight-0
// trap StatsService#comparableLb guards against for PR ranking.
public record ExerciseRecordsDto(
        List<RepMaxDto> repMaxes,
        RecordEntryDto heaviestWeight,
        RecordEntryDto bestSetVolume,
        RecordEntryDto bestSessionVolume,
        RecordEntryDto mostReps,
        int totalSets,
        int totalReps,
        BigDecimal totalVolumeLb,
        boolean bodyweightOnly) {
}
