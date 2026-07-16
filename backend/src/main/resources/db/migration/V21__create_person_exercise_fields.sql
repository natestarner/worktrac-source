-- Custom setup fields a person adds to an exercise as part of their personalization overlay
-- (e.g. their own "spotter pin" on a shared Bench Press). Because the overlay is per-person,
-- the recorded value lives inline on the row -- so custom fields never touch the shared
-- exercise_setup_fields / setup_values tables, which keep serving the exercise's base fields
-- exactly as before. A person's effective field list = base fields UNION these.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'person_exercise_fields')
BEGIN
    CREATE TABLE person_exercise_fields (
        id                  BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        person_exercise_id  BIGINT NOT NULL,
        name                NVARCHAR(100) NOT NULL,
        value               NVARCHAR(200) NULL,
        sort_order          INT NOT NULL DEFAULT 0,
        created_at          DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_person_exercise_fields_person_exercise FOREIGN KEY (person_exercise_id)
            REFERENCES person_exercise(id) ON DELETE CASCADE
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_person_exercise_fields_pe_id')
BEGIN
    CREATE INDEX IX_person_exercise_fields_pe_id ON person_exercise_fields(person_exercise_id);
END
