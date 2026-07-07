-- Ordered membership of a routine -- sort_order defines both which exercises belong to
-- the routine and the order stepping through it walks them in.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'routine_exercises')
BEGIN
    CREATE TABLE routine_exercises (
        id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        routine_id   BIGINT NOT NULL,
        exercise_id  BIGINT NOT NULL,
        sort_order   INT NOT NULL,
        CONSTRAINT FK_routine_exercises_routine FOREIGN KEY (routine_id)
            REFERENCES routines(id) ON DELETE CASCADE,
        CONSTRAINT FK_routine_exercises_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_routine_exercises_routine_id')
BEGIN
    CREATE INDEX IX_routine_exercises_routine_id ON routine_exercises(routine_id);
END
