-- Holds an unconfirmed registration (email, chosen names, hashed password, hashed 6-digit
-- code) until the code is confirmed. No FK to accounts/users -- none of those rows exist yet
-- at this stage. One row per email (see UX_pending_registrations_email below): re-registering
-- the same email while a pending row exists replaces it rather than accumulating duplicates.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'pending_registrations')
BEGIN
    CREATE TABLE pending_registrations (
        id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        email          NVARCHAR(255) NOT NULL,
        account_name   NVARCHAR(255) NULL,
        person_name    NVARCHAR(255) NOT NULL,
        password_hash  NVARCHAR(255) NOT NULL,
        code_hash      NVARCHAR(255) NOT NULL,
        expires_at     DATETIME2 NOT NULL,
        attempt_count  INT NOT NULL DEFAULT 0,
        last_sent_at   DATETIME2 NOT NULL DEFAULT GETDATE(),
        resend_count   INT NOT NULL DEFAULT 0,
        created_at     DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_pending_registrations_email')
BEGIN
    CREATE UNIQUE INDEX UX_pending_registrations_email ON pending_registrations(email);
END
