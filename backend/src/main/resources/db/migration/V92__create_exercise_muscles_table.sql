-- Which muscles an exercise works, and how: 'primary' (the muscle the movement is for) or
-- 'secondary' (a helper). Library exercises and household custom exercises use the same table;
-- a custom exercise's muscles are as visible as the exercise itself, and are codes from a fixed
-- list rather than free text, so they cannot carry a private client's own words to a sibling
-- (.claude/rules/coaching.md).
--
-- One row per (exercise, muscle): a muscle is either primary or secondary for an exercise, never
-- both. ON DELETE CASCADE because an exercise's muscles mean nothing without it, and account
-- deletion removes custom exercises with a bulk delete (ExerciseRepository.deleteByAccountIdIn).
-- That is the only cascade path into this table, so SQL Server's multiple-cascade-path rule is
-- not in play.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'exercise_muscles')
BEGIN
    CREATE TABLE exercise_muscles (
        id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_exercise_muscles PRIMARY KEY,
        exercise_id  BIGINT       NOT NULL,
        muscle_code  NVARCHAR(30) NOT NULL,
        role         NVARCHAR(10) NOT NULL
            CONSTRAINT CK_exercise_muscles_role CHECK (role IN ('primary', 'secondary')),
        CONSTRAINT FK_exercise_muscles_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id) ON DELETE CASCADE,
        CONSTRAINT FK_exercise_muscles_muscle FOREIGN KEY (muscle_code) REFERENCES muscles(code),
        CONSTRAINT UQ_exercise_muscles_exercise_muscle UNIQUE (exercise_id, muscle_code)
    );
END
