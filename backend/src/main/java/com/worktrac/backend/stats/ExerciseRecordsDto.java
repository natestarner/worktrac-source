package com.worktrac.backend.stats;

import java.math.BigDecimal;

// All-time records for one person + exercise, deliberately NOT scoped to the trends range toggle:
// a record is a record regardless of which window you're looking at, and keeping it range-free
// means the client caches it once instead of refetching on every 4wk/12wk/All click.
//
// bodyweightOnly is true when every set ever logged for this exercise had weight 0 (pull-ups,
// push-ups). Every weight-based record below is then meaningless -- they'd all read 0 lb -- so the
// client renders a rep-focused view instead. This is the same weight-0 trap
// StatsService#comparableLb guards against for PR ranking.
//
// bestEst1rm is Epley-estimated and therefore genuinely distinct from heaviestWeight: 185x8
// estimates to ~234 lb and outranks a 225x1 single. It is null only when every set is bodyweight
// (weight 0), where an Epley estimate would be meaningless -- which is exactly when
// bodyweightOnly is true, so a non-bodyweight exercise always has one.
//
// durationTracked flips the whole table to a time-focused view, for the same reason bodyweightOnly
// flips it to a rep-focused one: for a hold every weight-derived record is 0 (reps is 0, so volume
// is 0), and a column of "0 lb" is worse than no column. The two records that mean anything are
// longestHold and heaviestLoadHeld -- deliberately kept separate rather than fused into a single
// load-adjusted score, exactly as heaviestWeight sits beside bestEst1rm. bestEst1rm and mostReps
// are null whenever durationTracked is true.
public record ExerciseRecordsDto(
        RecordEntryDto bestEst1rm,
        RecordEntryDto heaviestWeight,
        RecordEntryDto bestSetVolume,
        RecordEntryDto bestSessionVolume,
        RecordEntryDto mostReps,
        RecordEntryDto longestHold,
        RecordEntryDto heaviestLoadHeld,
        int totalSets,
        int totalReps,
        int totalHoldSeconds,
        BigDecimal totalVolumeLb,
        boolean bodyweightOnly,
        boolean durationTracked) {
}
