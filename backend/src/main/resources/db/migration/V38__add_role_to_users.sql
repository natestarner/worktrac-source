-- Adds a role column to support an owner-only admin portal. Values are 'USER' (default,
-- every existing row) or 'ADMIN'. The env-driven allowlist (ADMIN_EMAILS) is the actual
-- source of truth for who is an admin -- this column is a cache reconciled at login (see
-- AuthService.login) and at startup (see AdminBootstrap), not something edited by hand.
IF NOT EXISTS (SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('users') AND name = 'role')
BEGIN
    ALTER TABLE users ADD role NVARCHAR(20) NOT NULL
        CONSTRAINT DF_users_role DEFAULT 'USER';
END
