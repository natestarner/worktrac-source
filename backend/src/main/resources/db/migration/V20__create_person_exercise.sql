-- The per-person personalization row layered on top of a shared exercise, without ever
-- mutating the exercise itself. One row per (person, exercise) captures:
--   * is_favorite   -- whether it shows in this person's Log picker
--   * person_category_id -- which of the person's own categories they filed it under (NULL
--                          = uncategorized)
-- A person's picker = these favorites UNION every exercise they have a logged set for.
-- exercise_id is intentionally NOT ON DELETE CASCADE: exercises are only soft-deleted, and
-- a stale row pointing at a soft-deleted exercise is simply filtered out by the read query.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'person_exercise')
BEGIN
    CREATE TABLE person_exercise (
        id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        person_id           BIGINT NOT NULL,
        exercise_id         BIGINT NOT NULL,
        is_favorite         BIT NOT NULL DEFAULT 0,
        person_category_id  BIGINT NULL,
        created_at          DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_person_exercise_person FOREIGN KEY (person_id)
            REFERENCES people(id) ON DELETE CASCADE,
        CONSTRAINT FK_person_exercise_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id),
        CONSTRAINT FK_person_exercise_category FOREIGN KEY (person_category_id)
            REFERENCES person_categories(id),
        CONSTRAINT UQ_person_exercise_person_exercise UNIQUE (person_id, exercise_id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_person_exercise_person_id')
BEGIN
    CREATE INDEX IX_person_exercise_person_id ON person_exercise(person_id);
END
