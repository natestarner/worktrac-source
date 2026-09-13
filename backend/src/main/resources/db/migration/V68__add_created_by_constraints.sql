-- Foreign keys and lookup indexes for V67's creator stamp.
--
-- ⚠️ Both foreign keys are NO ACTION (the default), deliberately, and must stay that way. Cascading
-- from users would give exercises a second path to deletion alongside accounts, which is the
-- multiple-cascade-path configuration SQL Server refuses outright -- the same reason
-- account_memberships (V63) and the import stamps (V55) are non-cascading.
--
-- ⚠️ THE COST IS A DELETION ORDER, AND IT IS NOT FREE. Every users row that gets deleted now needs
-- these stamps gone first:
--   * AccountDeletionService deletes exercises and tags before users. Both are DERIVED deletes,
--     which only queue entity removals, so it also flushes -- as INSURANCE against Hibernate's
--     action-queue ordering, not because a failure was observed. Its comment says so plainly and
--     is worth reading before touching either.
--   * TestDataCleanupService uses the single-statement bulk deletes, which run immediately, and
--     already deletes exercises and tags before its by-email user delete.
-- AccountDeletionTest and TestDataCleanupIntegrationTest both exercise these paths with a
-- household-created exercise and tag in place. Do not "tidy" these FKs into cascades to avoid the
-- ordering -- the database will reject it, and the failure reads as an unrelated migration error.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_exercises_created_by_user')
BEGIN
    ALTER TABLE exercises ADD CONSTRAINT FK_exercises_created_by_user
        FOREIGN KEY (created_by_user_id) REFERENCES users(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tags_created_by_user')
BEGIN
    ALTER TABLE tags ADD CONSTRAINT FK_tags_created_by_user
        FOREIGN KEY (created_by_user_id) REFERENCES users(id);
END

-- Filtered to non-null, matching V55's reasoning: the whole preloaded catalog is null here, and it
-- dwarfs what any household creates. The lookups that matter are "did THIS login create this row"
-- and, at deletion time, "does anything still point at this user".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exercises_created_by_user_id' AND object_id = OBJECT_ID('exercises'))
BEGIN
    CREATE INDEX IX_exercises_created_by_user_id ON exercises(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tags_created_by_user_id' AND object_id = OBJECT_ID('tags'))
BEGIN
    CREATE INDEX IX_tags_created_by_user_id ON tags(created_by_user_id) WHERE created_by_user_id IS NOT NULL;
END
