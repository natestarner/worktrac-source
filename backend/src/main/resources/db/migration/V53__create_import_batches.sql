-- One row per committed CSV/Excel import. Everything an import writes is stamped with this id
-- (see V54), which is what makes an import reversible and what lets imported data be identified
-- later -- neither is answerable from the workout rows themselves, since an imported set is
-- deliberately indistinguishable from a hand-logged one in every other respect.
--
-- person_id, not account_id: an import targets exactly one person, and undo is scoped by person
-- as well as by batch so a bug in the stamp can never reach across the per-person boundary this
-- whole app exists to keep (see csvimport/ImportUndoService).
--
-- undone_at is a soft marker rather than a DELETE: the counts stay readable as an audit trail of
-- what was brought in and then taken back out, which is exactly the history someone reaches for
-- when their data looks wrong.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'import_batches')
BEGIN
    CREATE TABLE import_batches (
        id                      BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        person_id               BIGINT NOT NULL,
        created_by_user_id      BIGINT NOT NULL,
        filename                NVARCHAR(255) NULL,
        set_count               INT NOT NULL,
        session_count           INT NOT NULL,
        skipped_duplicate_count INT NOT NULL,
        undone_at               DATETIME2 NULL,
        created_at              DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_import_batches_person FOREIGN KEY (person_id) REFERENCES people(id),
        CONSTRAINT FK_import_batches_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );
END

-- Backs the "recent imports for this person" list, newest first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_batches_person_id_created_at')
BEGIN
    CREATE INDEX IX_import_batches_person_id_created_at ON import_batches(person_id, created_at DESC);
END
