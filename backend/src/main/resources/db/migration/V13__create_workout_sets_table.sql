-- A single logged set: weight x reps, unit stamped at the moment it was logged (never
-- recomputed when the account's default unit changes later). person_id is denormalized
-- from the parent session for query convenience (must always match session.person_id --
-- enforced at the service layer, not by a CHECK constraint, since T-SQL can't easily
-- cross-table-validate that). Its FK to people is intentionally NOT ON DELETE CASCADE:
-- session_id's cascade (workout_sessions -> this table) already reaches every row a
-- person-delete needs to remove, and SQL Server rejects a second cascade path back to
-- the same ultimate table (people) through two different routes.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'workout_sets')
BEGIN
    CREATE TABLE workout_sets (
        id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        session_id   BIGINT NOT NULL,
        person_id    BIGINT NOT NULL,
        exercise_id  BIGINT NOT NULL,
        weight       DECIMAL(6,2) NOT NULL,
        reps         INT NOT NULL,
        unit         NVARCHAR(2) NOT NULL CHECK (unit IN ('lb', 'kg')),
        created_at   DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_workout_sets_session FOREIGN KEY (session_id)
            REFERENCES workout_sessions(id) ON DELETE CASCADE,
        CONSTRAINT FK_workout_sets_person FOREIGN KEY (person_id)
            REFERENCES people(id),
        CONSTRAINT FK_workout_sets_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sets_session_id')
BEGIN
    CREATE INDEX IX_workout_sets_session_id ON workout_sets(session_id);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sets_person_id_exercise_id')
BEGIN
    CREATE INDEX IX_workout_sets_person_id_exercise_id ON workout_sets(person_id, exercise_id);
END
