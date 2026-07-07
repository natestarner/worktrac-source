-- Lets a household "fork" a shared system exercise into an account-owned copy the
-- first time they edit or delete it -- the original global row (and every other
-- household's view of it) is left completely untouched; only the forking account's
-- own historical sets/routine entries/setup values get re-pointed to the new copy.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('exercises') AND name = 'forked_from_id')
BEGIN
    ALTER TABLE exercises ADD forked_from_id BIGINT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_exercises_forked_from')
BEGIN
    ALTER TABLE exercises ADD CONSTRAINT FK_exercises_forked_from FOREIGN KEY (forked_from_id) REFERENCES exercises(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exercises_forked_from_id')
BEGIN
    CREATE INDEX IX_exercises_forked_from_id ON exercises(forked_from_id);
END
