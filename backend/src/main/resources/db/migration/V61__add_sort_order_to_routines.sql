-- Explicit, user-controlled ordering for a person's routines.
--
-- Routines were listed by created_at ASC -- oldest first -- which put the routine someone built
-- first (and most likely abandoned) at the top of the Log picker's "Start a routine" list, and
-- their current program at the bottom. Order is now a preference, set by dragging on the
-- Routines tab.
--
-- Added NULL here and backfilled + tightened to NOT NULL in V62, rather than all at once: T-SQL
-- compiles a batch as a whole, so an UPDATE naming a column added earlier in the same batch
-- fails to parse. Splitting across two migrations is also what this codebase already does for
-- every other backfill (V23, V24, V26, V31) and avoids needing a GO separator, which no
-- migration here uses.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('routines') AND name = 'sort_order')
BEGIN
    ALTER TABLE routines ADD sort_order INT NULL;
END
