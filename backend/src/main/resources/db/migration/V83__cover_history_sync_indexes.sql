-- V82's History-sync indexes did not COVER the month load (HistoryMonths), so for each set it read,
-- SQL Server had to either look the row up in the clustered index or -- on a large table, which it
-- judged cheaper -- scan the whole of workout_sets. On lower (Basic tier, and tables holding every e2e
-- household ever created) one full sync for five years of History ran ~10 minutes at 100% DTU.
--
-- The rule these restore: every History-sync statement must cost in proportion to THIS PERSON's rows,
-- never to the table. Each index below now carries every column the aggregate and the load read, so
-- both are a seek on the person's range and nothing else. Measured locally against lower-sized tables
-- (see docs/architecture/history-sync.md, "Cost").
--
-- DROP + CREATE rather than ALTER: an index's INCLUDE list cannot be altered in place.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sets_person_id_session_id')
BEGIN
    DROP INDEX IX_workout_sets_person_id_session_id ON workout_sets;
END

CREATE INDEX IX_workout_sets_person_id_session_id
    ON workout_sets(person_id, session_id)
    INCLUDE (exercise_id, row_version, weight, reps, duration_seconds, unit, created_at);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sessions_person_id_started_at')
BEGIN
    DROP INDEX IX_workout_sessions_person_id_started_at ON workout_sessions;
END

CREATE INDEX IX_workout_sessions_person_id_started_at
    ON workout_sessions(person_id, started_at)
    INCLUDE (row_version, ended_at, manual);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_session_exercise_notes_session_id')
BEGIN
    DROP INDEX IX_session_exercise_notes_session_id ON session_exercise_notes;
END

CREATE INDEX IX_session_exercise_notes_session_id
    ON session_exercise_notes(session_id)
    INCLUDE (row_version, exercise_id, note);
