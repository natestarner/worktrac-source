-- Foreign keys and lookup indexes for V54's import stamp.
--
-- ⚠️ Every one of these is NO ACTION (the default) -- deliberately, and it must stay that way.
-- workout_sets already reaches people by two routes: directly via person_id, and via
-- workout_sessions ON DELETE CASCADE. Adding a third cascading path through import_batches is
-- exactly the multiple-cascade-path configuration SQL Server refuses to create, and it is the
-- same reason workout_sets.person_id is already non-cascading.
--
-- The cost of NO ACTION is that deletion order becomes app code's problem: AccountDeletionService
-- and TestDataCleanupService both have to clear these stamps (or their rows) before the
-- import_batches rows they point at, and the batches before the people and users they reference.
-- Both have tests pinning that. Do not "tidy" these into cascades to avoid that ordering -- the
-- database will reject it, and the failure looks like an unrelated migration error.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_workout_sets_import_batch')
BEGIN
    ALTER TABLE workout_sets ADD CONSTRAINT FK_workout_sets_import_batch
        FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_workout_sessions_import_batch')
BEGIN
    ALTER TABLE workout_sessions ADD CONSTRAINT FK_workout_sessions_import_batch
        FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_session_exercise_notes_import_batch')
BEGIN
    ALTER TABLE session_exercise_notes ADD CONSTRAINT FK_session_exercise_notes_import_batch
        FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
END

-- Filtered to non-null: undo looks rows up by batch, and the overwhelming majority of rows in
-- these tables were never imported at all.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sets_import_batch_id' AND object_id = OBJECT_ID('workout_sets'))
BEGIN
    CREATE INDEX IX_workout_sets_import_batch_id ON workout_sets(import_batch_id) WHERE import_batch_id IS NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_workout_sessions_import_batch_id' AND object_id = OBJECT_ID('workout_sessions'))
BEGIN
    CREATE INDEX IX_workout_sessions_import_batch_id ON workout_sessions(import_batch_id) WHERE import_batch_id IS NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_session_exercise_notes_import_batch_id' AND object_id = OBJECT_ID('session_exercise_notes'))
BEGIN
    CREATE INDEX IX_session_exercise_notes_import_batch_id ON session_exercise_notes(import_batch_id) WHERE import_batch_id IS NOT NULL;
END
