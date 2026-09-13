-- EXPAND half of an expand/contract. account_memberships is now the source of truth for which
-- account a login belongs to, and the entity stops mapping users.account_id in this same release.
--
-- ⚠️ THE COLUMN CANNOT SIMPLY BE LEFT ALONE, AND IT MUST NOT BE DROPPED HERE EITHER.
--
--   Left NOT NULL: the next user inserted (the first invited member, in phase 7) has no account_id
--   to supply, and the INSERT fails outright. Hibernate's ddl-auto: validate does not object to a
--   column the entity no longer maps, so nothing would catch this before runtime.
--
--   Dropped now: a rolling deploy runs the migration against a database the PREVIOUS revision is
--   still serving, and that revision reads the column. It would start 500ing until the last old
--   replica drained.
--
-- So: nullable now, dropped a release later (phase 7's V72), once no running code reads it. The
-- data stays intact in the meantime, which also makes this migration trivially reversible if
-- phase 2 has to be rolled back.
--
-- Changing NOT NULL -> NULL is permitted even though IX_users_account_id covers the column: SQL
-- Server blocks ALTER COLUMN on an indexed column only when the type or length changes.
IF EXISTS (SELECT 1
             FROM sys.columns
            WHERE object_id = OBJECT_ID('users')
              AND name = 'account_id'
              AND is_nullable = 0)
BEGIN
    ALTER TABLE users ALTER COLUMN account_id BIGINT NULL;
END
