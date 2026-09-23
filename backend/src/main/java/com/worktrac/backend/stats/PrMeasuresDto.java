package com.worktrac.backend.stats;

// The four measures the PRs board offers BESIDE est. 1RM, which stays on PrRowDto.best -- see the
// comment there for why it is not repeated in here.
//
// A null entry means the measure is meaningless for this exercise, never that it is zero. heaviest
// and bestSetVolume are raw weight or weight x reps, so for an exercise whose whole history is
// bodyweight they would be a column of "0 lb"; for a hold reps are 0, so bestSetVolume and
// totalReps collapse the same way. sessionVolume is never null for a logged exercise: it is
// measured in the exercise's own unit (PrRowDto.volumeKind -- total reps for bodyweight, total
// seconds for a hold), so it always has a real value. That is the call ExerciseRecordsDto's
// bodyweightOnly / durationTracked branches already make one screen over, and the one
// exerciseMetrics.js#visibleMetricOptions makes for the chart's metric switcher.
public record PrMeasuresDto(PrMeasureDto heaviest, PrMeasureDto sessionVolume,
                            PrMeasureDto bestSetVolume, PrMeasureDto totalReps) {
}
