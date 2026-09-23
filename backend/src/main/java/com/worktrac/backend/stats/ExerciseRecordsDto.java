package com.worktrac.backend.stats;

import java.math.BigDecimal;

// All-time records for one person + exercise, deliberately NOT scoped to the trends range toggle:
// a record is a record regardless of which window you're looking at, and keeping it range-free
// means the client caches it once instead of refetching on every 4wk/12wk/All click.
//
// bodyweightOnly is true when every set ever logged for this exercise had weight 0 (pull-ups,
// push-ups). Every weight-based record below is then meaningless -- they'd all read 0 lb -- so the
// client renders a rep-focused view instead. This is the same weight-0 trap
// SetMeasures#comparableLb guards against for PR ranking.
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
//
// bestSessionVolume is the exception to all of the above: it is measured in the exercise's own
// unit (SessionVolume -- pounds, total reps for an unloaded exercise, total seconds for a hold),
// so it exists in every view, and volumeKind names which. Its `valueLb` carries that value
// whatever the unit, the same way mostReps' and longestHold's already do. totalVolumeLb and
// bestSetVolume stay weight x reps.
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
        boolean durationTracked,
        String volumeKind) {
}
