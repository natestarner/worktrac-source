package com.worktrac.backend.stats;

// One row on the PRs board: an exercise, its all-time best, and that best re-measured four other
// ways for the board's record picker.
//
// `best` IS the est.-1RM measure and is deliberately NOT repeated inside `measures`. It is the set
// bestSet() picks via comparableValue, which already substitutes rep count at weight 0 and seconds
// for a hold -- the substitutions EXERCISE_METRICS.est1rm's copy describes. Carrying it twice would
// be two representations of one number that could drift.
//
// bodyweightOnly / durationTracked mirror the ExerciseRecordsDto fields of the same name and answer
// the same question one screen over: which readouts must DISAPPEAR rather than render zeros. The
// board needs them per row (unlike the records table, which is one exercise at a time) because the
// record picker is board-wide while applicability is per-exercise.
public record PrRowDto(Long exerciseId, String exerciseName, BestDto best, PrMeasuresDto measures,
                       boolean bodyweightOnly, boolean durationTracked) {
}
