-- Shared, per-account tag vocabulary. Replaces the per-person "categories" concept with a
-- many-to-many tagging model: tags belong to the household (account) and everyone picks from
-- the same free-text vocabulary. Which exercises each person tags stays per-person (see
-- person_exercise_tags). account_id is NOT NULL -- there is no global/system tag seed.
-- No ON DELETE CASCADE to accounts: account deletion clears tags explicitly in
-- AccountDeletionService (mirrors how legacy categories were cleaned up), which keeps the
-- person_exercise_tags join free of a second cascade path to accounts.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tags')
BEGIN
    CREATE TABLE tags (
        id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id  BIGINT NOT NULL,
        name        NVARCHAR(100) NOT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_tags_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tags_account_name')
BEGIN
    CREATE UNIQUE INDEX UX_tags_account_name ON tags(account_id, name);
END
