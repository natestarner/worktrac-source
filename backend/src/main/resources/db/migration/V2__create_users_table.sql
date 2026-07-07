-- Login credentials. One User per Account (the primary/registering login) for now --
-- multiple Users sharing one Account is a reasonable future extension, not built yet.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE users (
        id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id     BIGINT NOT NULL,
        email          NVARCHAR(255) NOT NULL,
        password_hash  NVARCHAR(255) NOT NULL,
        created_at     DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_users_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_users_email')
BEGIN
    CREATE UNIQUE INDEX UX_users_email ON users(email);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_account_id')
BEGIN
    CREATE INDEX IX_users_account_id ON users(account_id);
END
