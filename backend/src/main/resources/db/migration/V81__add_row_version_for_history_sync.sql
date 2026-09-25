-- A ROWVERSION on every table History is built from, so the History sync can tell which months of a
-- person's history changed WITHOUT building them (HistoryFingerprintRepository).
--
-- ROWVERSION, not an updated_at maintained by the app, and that is the whole point: SQL Server stamps
-- it on every INSERT and UPDATE -- JPA, native SQL, bulk import, a cascade -- so there is no write path
-- that can forget to bump it. Every new value is greater than every value already in the database,
-- which is what makes a month's (COUNT, SUM(row_version)) change on any insert, update or delete.
--
-- exercises is included because History carries each entry's exercise NAME: a rename changes every
-- month that logged that exercise, for every person who logged it.
--
-- The columns are deliberately not mapped on the JPA entities -- nothing but the fingerprint query
-- reads them, and ddl-auto=validate ignores unmapped columns. A table can hold only one ROWVERSION.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('workout_sessions') AND name = 'row_version')
BEGIN
    ALTER TABLE workout_sessions ADD row_version ROWVERSION NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('workout_sets') AND name = 'row_version')
BEGIN
    ALTER TABLE workout_sets ADD row_version ROWVERSION NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('session_exercise_notes') AND name = 'row_version')
BEGIN
    ALTER TABLE session_exercise_notes ADD row_version ROWVERSION NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('exercises') AND name = 'row_version')
BEGIN
    ALTER TABLE exercises ADD row_version ROWVERSION NOT NULL;
END
