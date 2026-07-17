-- System A retired: shared setup-field names are no longer used (all setup fields are
-- per-person now, stored in person_exercise_fields). setup_values -- the only FK dependent --
-- was dropped in V27, so this table can go too.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'exercise_setup_fields')
BEGIN
    DROP TABLE exercise_setup_fields;
END
