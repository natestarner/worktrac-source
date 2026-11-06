-- Other names a LIBRARY exercise goes by, for search: "OHP" and "Military Press" find Barbell
-- Overhead Press, "RDL" finds Romanian Deadlift. Search only -- an alias is never shown as the name,
-- never written to History, and never matched by the duplicate-name check on create (that stays on
-- exercises.name, so creating "Military Press" still makes a custom exercise rather than silently
-- opening the library row).
--
-- Library rows only, arriving by migration like the library itself. One row per (exercise, alias);
-- ON DELETE CASCADE for the same reason as exercise_muscles (V92).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'exercise_aliases')
BEGIN
    CREATE TABLE exercise_aliases (
        id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_exercise_aliases PRIMARY KEY,
        exercise_id BIGINT        NOT NULL,
        alias       NVARCHAR(200) NOT NULL,
        CONSTRAINT FK_exercise_aliases_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id) ON DELETE CASCADE,
        CONSTRAINT UQ_exercise_aliases_exercise_alias UNIQUE (exercise_id, alias)
    );
END
