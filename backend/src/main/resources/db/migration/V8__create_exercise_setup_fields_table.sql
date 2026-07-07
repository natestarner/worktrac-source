-- Per-exercise equipment setup field *names* (e.g. "Bar catch pin"), defined once per
-- exercise in Admin and shared by everyone who does that exercise. The actual per-person
-- values live in setup_values (V14), keyed by this table's id.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'exercise_setup_fields')
BEGIN
    CREATE TABLE exercise_setup_fields (
        id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        exercise_id  BIGINT NOT NULL,
        name         NVARCHAR(100) NOT NULL,
        sort_order   INT NOT NULL DEFAULT 0,
        created_at   DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_exercise_setup_fields_exercise FOREIGN KEY (exercise_id)
            REFERENCES exercises(id) ON DELETE CASCADE
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exercise_setup_fields_exercise_id')
BEGIN
    CREATE INDEX IX_exercise_setup_fields_exercise_id ON exercise_setup_fields(exercise_id);
END
