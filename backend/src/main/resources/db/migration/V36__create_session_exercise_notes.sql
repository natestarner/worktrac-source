-- A note about how a specific exercise went in a specific workout session (e.g. "shoulder
-- felt off today, cut it short"), as opposed to the standing per-person note added in V35.
-- There is no existing row representing "an exercise within a session" -- it only exists
-- implicitly as the workout_sets rows sharing (session_id, exercise_id) -- so this is a new
-- table keyed on that same pair, one optional note row per pair.
-- exercise_id is intentionally NOT ON DELETE CASCADE, matching person_exercise (V20):
-- exercises are only soft-deleted, and a stale row pointing at a soft-deleted exercise is
-- simply filtered out by the read query.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'session_exercise_notes')
BEGIN
    CREATE TABLE session_exercise_notes (
        id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        session_id  BIGINT NOT NULL,
        exercise_id BIGINT NOT NULL,
        note        NVARCHAR(1000) NOT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
        updated_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_session_exercise_notes_session FOREIGN KEY (session_id)
            REFERENCES workout_sessions(id) ON DELETE CASCADE,
        CONSTRAINT FK_session_exercise_notes_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id),
        CONSTRAINT UQ_session_exercise_notes_session_exercise UNIQUE (session_id, exercise_id)
    );
END
