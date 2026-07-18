-- Holds an outstanding password-reset code (hashed, never plaintext) for an existing user.
-- No FK to users -- requesting a reset for an unregistered email must not fail or reveal
-- whether the email has an account, so this table has to be able to hold a row (or, more
-- precisely, NOT hold a row) independently of whether a matching user exists. One row per
-- email (see UX_password_reset_codes_email below): requesting another reset while one is
-- already outstanding replaces it rather than accumulating duplicates.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'password_reset_codes')
BEGIN
    CREATE TABLE password_reset_codes (
        id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        email          NVARCHAR(255) NOT NULL,
        code_hash      NVARCHAR(255) NOT NULL,
        expires_at     DATETIME2 NOT NULL,
        attempt_count  INT NOT NULL DEFAULT 0,
        last_sent_at   DATETIME2 NOT NULL DEFAULT GETDATE(),
        resend_count   INT NOT NULL DEFAULT 0,
        created_at     DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_password_reset_codes_email')
BEGIN
    CREATE UNIQUE INDEX UX_password_reset_codes_email ON password_reset_codes(email);
END
