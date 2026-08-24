-- The import stamp, on each of the three tables an import can write rows to. One logical change
-- -- the same column, for the same reason -- so it belongs in one migration.
--
-- Nullable everywhere and null for everything logged in the app: the stamp answers "did an import
-- create this row", and the honest answer for a hand-logged set is "no", not "unknown".
--
-- The foreign keys and indexes are added separately in V55, because SQL Server can't reference a
-- column added earlier in the same un-batched script -- the same reason V40/V41, V42/V43 and
-- V47/V48 are split pairs.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('workout_sets') AND name = 'import_batch_id')
BEGIN
    ALTER TABLE workout_sets ADD import_batch_id BIGINT NULL;
END

-- Only set on a session the import CREATED, never on a pre-existing one it appended rows to.
-- Undo leans on that distinction: it may delete a session it made, and must not delete one that
-- was already there.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('workout_sessions') AND name = 'import_batch_id')
BEGIN
    ALTER TABLE workout_sessions ADD import_batch_id BIGINT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('session_exercise_notes') AND name = 'import_batch_id')
BEGIN
    ALTER TABLE session_exercise_notes ADD import_batch_id BIGINT NULL;
END
