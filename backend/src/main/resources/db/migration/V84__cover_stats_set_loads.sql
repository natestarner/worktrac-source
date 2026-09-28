-- StatsService loads workout_sets as whole entities -- every mapped column -- in two shapes:
--   * one exercise for one person (twice inside every set's save, for its PR check; the Log screen's
--     summary, on every logged set and every exercise opened; and the per-exercise trend and records
--     endpoints), through (person_id, exercise_id);
--   * the whole person (GET /prs, the Trends overview, CSV export), through (person_id, session_id).
-- Neither index carried the entity's columns, so the first did a key lookup for every set (~5,900
-- page reads for one exercise at five years) and the second was abandoned for a SCAN of workout_sets
-- and workout_sessions -- a cost that follows the table, not the person (2.9s of database time per
-- call on lower at five years; docs/architecture/prs-trends-from-history.md, "Baseline").
--
-- The fix is the one V83 made for History: each index carries every column its readers load, so both
-- are a seek on this person's range. The columns are WorkoutSet's mapped ones -- if that entity gains
-- a column, add it here (in a new migration) or these loads go back to lookups; StatsCostTest fails
-- when they do.
--
-- IX_workout_sets_person_id_session_id keeps exactly V83's columns (History's sync reads them) and
-- adds the three the entity also maps. DROP + CREATE: an INCLUDE list cannot be altered in place.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sets_person_id_exercise_id')
BEGIN
    DROP INDEX IX_workout_sets_person_id_exercise_id ON workout_sets;
END

CREATE INDEX IX_workout_sets_person_id_exercise_id
    ON workout_sets(person_id, exercise_id)
    INCLUDE (session_id, weight, reps, duration_seconds, unit, created_at, rest_seconds, client_key, import_batch_id);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sets_person_id_session_id')
BEGIN
    DROP INDEX IX_workout_sets_person_id_session_id ON workout_sets;
END

CREATE INDEX IX_workout_sets_person_id_session_id
    ON workout_sets(person_id, session_id)
    INCLUDE (exercise_id, row_version, weight, reps, duration_seconds, unit, created_at, rest_seconds, client_key, import_batch_id);

-- The same loads fetch each set's session (WorkoutSession, every mapped column). The queries now also
-- say the session belongs to the same person (WorkoutSetRepository), which lets SQL Server seek this
-- person's sessions instead of scanning the table -- and this index, carrying every column the entity
-- maps, lets that seek stand on its own. V83's columns kept (History reads them).

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sessions_person_id_started_at')
BEGIN
    DROP INDEX IX_workout_sessions_person_id_started_at ON workout_sessions;
END

CREATE INDEX IX_workout_sessions_person_id_started_at
    ON workout_sessions(person_id, started_at)
    INCLUDE (row_version, ended_at, manual, last_activity_at, created_at, import_batch_id);

-- V12's narrower (person_id) index is the one SQL Server actually chose for the per-exercise load --
-- and, covering nothing, it then looked every one of the person's sessions up in the clustered index
-- (~5,500 page reads for one exercise at five years, WORSE than before). Covering it too means the
-- seek on this person's sessions carries the session whichever of the two indexes a plan picks.
-- Nothing is lost: it keeps its key, so every query that used it still can.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sessions_person_id')
BEGIN
    DROP INDEX IX_workout_sessions_person_id ON workout_sessions;
END

CREATE INDEX IX_workout_sessions_person_id
    ON workout_sessions(person_id)
    INCLUDE (started_at, ended_at, last_activity_at, manual, created_at, import_batch_id);
