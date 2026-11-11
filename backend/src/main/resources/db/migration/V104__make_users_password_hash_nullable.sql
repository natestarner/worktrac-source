-- A login created with Apple or Google has no password until its owner chooses to set one.
--
-- NULL means "no password", and every path that compares a password treats it exactly like a
-- wrong one, including the time it takes (AuthService.verifyCredentials spends a BCrypt
-- comparison against DUMMY_HASH). A different answer, or a faster one, would tell anybody typing
-- an address at the sign-in form that it belongs to an Apple or Google login.
--
-- Expand-only: no existing row changes, and the previous release never writes NULL, so old and new
-- replicas can run side by side during the deploy.
IF EXISTS (SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('users') AND name = 'password_hash' AND is_nullable = 0)
BEGIN
    ALTER TABLE users ALTER COLUMN password_hash NVARCHAR(255) NULL;
END
