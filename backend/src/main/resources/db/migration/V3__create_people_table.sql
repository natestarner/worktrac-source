-- Non-login profiles (the primary registrant, plus kids/training partners added from
-- inside the app) that all workout data (routines, sessions, sets, setup values) is
-- scoped to. is_primary marks the one Person tied to the account's real login.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'people')
BEGIN
    CREATE TABLE people (
        id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id  BIGINT NOT NULL,
        name        NVARCHAR(100) NOT NULL,
        is_primary  BIT NOT NULL DEFAULT 0,
        created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_people_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_people_account_id')
BEGIN
    CREATE INDEX IX_people_account_id ON people(account_id);
END
