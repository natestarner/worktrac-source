-- Indexes for the History sync (V81's row_version). Its own migration because an index cannot name a
-- column added earlier in the same batch.
--
-- The fingerprint query groups a person's sessions -- and the sets and notes under them -- by the
-- UTC month of started_at, and the month loads read one started_at range. Before this there was no
-- (person_id, started_at) index at all; every History read scanned by person_id and sorted.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sessions_person_id_started_at')
BEGIN
    CREATE INDEX IX_workout_sessions_person_id_started_at
        ON workout_sessions(person_id, started_at) INCLUDE (row_version);
END

-- Covers the set half of the fingerprint: every set of the person, the session it belongs to (for its
-- month), the exercise it names (for that exercise's row_version), and its own row_version.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sets_person_id_session_id')
BEGIN
    CREATE INDEX IX_workout_sets_person_id_session_id
        ON workout_sets(person_id, session_id) INCLUDE (exercise_id, row_version);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_session_exercise_notes_session_id')
BEGIN
    CREATE INDEX IX_session_exercise_notes_session_id
        ON session_exercise_notes(session_id) INCLUDE (row_version);
END
