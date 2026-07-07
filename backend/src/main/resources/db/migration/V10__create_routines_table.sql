-- Optional, user-created ordered exercise lists -- a convenience navigation layer over
-- freeform logging. Personal to one Person, not shared across a household.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'routines')
BEGIN
    CREATE TABLE routines (
        id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        person_id   BIGINT NOT NULL,
        name        NVARCHAR(200) NOT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_routines_person FOREIGN KEY (person_id)
            REFERENCES people(id) ON DELETE CASCADE
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_routines_person_id')
BEGIN
    CREATE INDEX IX_routines_person_id ON routines(person_id);
END
