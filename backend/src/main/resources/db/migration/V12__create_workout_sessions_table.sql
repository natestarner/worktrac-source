-- A single workout occasion for one Person. last_activity_at (updated every time a set
-- is logged into this session) -- not started_at -- is what the 8-hour auto-close rule
-- measures from, so a long-running live session doesn't get incorrectly treated as stale.
-- manual=1 marks a session created retroactively via History > "Log a past workout"
-- (ended_at is set equal to started_at for those -- a point-in-time marker, not a real
-- range, until sets are logged into it).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'workout_sessions')
BEGIN
    CREATE TABLE workout_sessions (
        id                 BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        person_id          BIGINT NOT NULL,
        started_at         DATETIME2 NOT NULL,
        ended_at           DATETIME2 NULL,
        last_activity_at   DATETIME2 NOT NULL,
        manual             BIT NOT NULL DEFAULT 0,
        created_at         DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_workout_sessions_person FOREIGN KEY (person_id)
            REFERENCES people(id) ON DELETE CASCADE
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sessions_person_id')
BEGIN
    CREATE INDEX IX_workout_sessions_person_id ON workout_sessions(person_id);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sessions_person_id_ended_at')
BEGIN
    CREATE INDEX IX_workout_sessions_person_id_ended_at ON workout_sessions(person_id, ended_at);
END
