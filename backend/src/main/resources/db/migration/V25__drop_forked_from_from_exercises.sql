-- Removes the dead fork-on-edit machinery. Fork-on-edit was retired in the favorites
-- rebuild: preloaded (global) exercises are now immutable and nothing ever sets
-- forked_from_id, so the column is NULL on every row and the visibility query's exclusion
-- subquery is a permanent no-op. Dropping the column (and its FK/index) is therefore
-- behavior-preserving.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exercises_forked_from_id')
BEGIN
    DROP INDEX IX_exercises_forked_from_id ON exercises;
END

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_exercises_forked_from')
BEGIN
    ALTER TABLE exercises DROP CONSTRAINT FK_exercises_forked_from;
END

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('exercises') AND name = 'forked_from_id')
BEGIN
    ALTER TABLE exercises DROP COLUMN forked_from_id;
END
