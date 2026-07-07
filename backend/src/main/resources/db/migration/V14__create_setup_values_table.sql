-- The actual per-person value (e.g. "5") for one of an exercise's setup fields -- body
-- size differs per person even though the field names are shared. FKs to
-- exercise_setup_fields.id rather than duplicating the field name as a free string
-- (as the requirements doc's schema sketch suggested), avoiding string-matching drift
-- and getting cascade cleanup for free if a field is ever removed from an exercise.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'setup_values')
BEGIN
    CREATE TABLE setup_values (
        id                        BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        person_id                 BIGINT NOT NULL,
        exercise_setup_field_id   BIGINT NOT NULL,
        value                     NVARCHAR(200) NOT NULL,
        updated_at                DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_setup_values_person FOREIGN KEY (person_id)
            REFERENCES people(id) ON DELETE CASCADE,
        CONSTRAINT FK_setup_values_field FOREIGN KEY (exercise_setup_field_id)
            REFERENCES exercise_setup_fields(id) ON DELETE CASCADE
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_setup_values_person_field')
BEGIN
    CREATE UNIQUE INDEX UX_setup_values_person_field ON setup_values(person_id, exercise_setup_field_id);
END
