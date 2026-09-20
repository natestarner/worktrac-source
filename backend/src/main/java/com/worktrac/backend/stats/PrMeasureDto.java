package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

// One all-time best for one person + exercise on ONE measure, for the PRs board's record picker.
//
// `value` is whatever that measure maximizes, so it is NOT always pounds: pounds for heaviest /
// sessionVolume / bestSetVolume, a rep count for totalReps. The consumer knows which measure it
// asked for -- the same contract RecordEntryDto.valueLb already carries on the records endpoint.
//
// Weights are normalized to POUNDS here rather than sent in the set's own unit. prSort.js already
// has to call toLb() before ranking `best.est1rm` for exactly this reason (a kg household would
// otherwise compare 100 against 200 numerically), and doing it once server-side means the client
// ranks and renders through one path instead of re-deriving the normalization per measure.
//
// weightLb/reps describe the set behind the record and are null for a SESSION-level measure
// (sessionVolume, totalReps), where no single set is the answer.
//
// `sets` is the other half of that answer: for a session-level measure it is the BREAKDOWN of the
// session that set the record, collapsed into runs (see PrSetDto), and `setCount` is the true
// total number of sets in it -- so a client that truncates the list can say "+3 more" honestly
// rather than implying the record was set in fewer sets than it was. Empty and 0 for a set-level
// measure, which already names its own set through weightLb/reps.
//
// ⚠️ The list is CAPPED (StatsService.MAX_PR_BREAKDOWN_RUNS). This DTO rides on
// /api/people/{personId}/prs, which returns a row per exercise and is warmed into IndexedDB by
// offlineCacheWarm -- an uncapped breakdown would grow that persisted blob without bound for a
// household with long workouts.
//
// sessionStartedAt is an Instant, not a LocalDate: /api/people/{personId}/prs takes no `zone`
// param, and the board already formats best.sessionStartedAt client-side through toLocalDateStr.
public record PrMeasureDto(BigDecimal value, BigDecimal weightLb, Integer reps,
                           Instant sessionStartedAt, List<PrSetDto> sets, int setCount) {
}
