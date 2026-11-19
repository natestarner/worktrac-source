-- CONTRACT half of V65's expand/contract: drop users.account_id, its index and its FK to accounts.
--
-- Why now, and why it is a bug fix rather than tidy-up: the column has been unmapped and unread
-- since #250 (member logins, phase 2), but every login created BEFORE #250 still carries the id of
-- the household it registered in, and FK_users_account still enforces it. AccountDeletionService
-- correctly keeps a login that belongs to another household too -- so deleting the household that
-- login registered in failed its final DELETE FROM accounts on this FK, and the person got a 503
-- ("having trouble reaching your data") on every attempt (docs/incidents/2026-11-19-...).
--
-- Safe against a rolling deploy: no running revision reads this column. Production and lower both
-- ran d7cbcd9 when this was written, years of releases past #250, and Hibernate (ddl-auto:
-- validate) never named the column once User stopped mapping it.
--
-- Nothing is lost: account_memberships (V63, backfilled from this very column by V64) is the
-- only source of truth for which households a login belongs to. Do NOT "rescue" the column by
-- backfilling memberships from it first -- a login whose membership was REVOKED still carries its
-- old account_id here, and re-creating that membership would silently undo the revocation.
--
-- Order is forced: the FK and the index both depend on the column.
IF EXISTS (SELECT 1 FROM sys.foreign_keys
            WHERE name = 'FK_users_account' AND parent_object_id = OBJECT_ID('users'))
BEGIN
    ALTER TABLE users DROP CONSTRAINT FK_users_account;
END

IF EXISTS (SELECT 1 FROM sys.indexes
            WHERE name = 'IX_users_account_id' AND object_id = OBJECT_ID('users'))
BEGIN
    DROP INDEX IX_users_account_id ON users;
END

IF EXISTS (SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('users') AND name = 'account_id')
BEGIN
    ALTER TABLE users DROP COLUMN account_id;
END
