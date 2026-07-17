-- System A retired: per-person values now live inline in person_exercise_fields (back-filled
-- in V26). Drop the shared value table.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'setup_values')
BEGIN
    DROP TABLE setup_values;
END
