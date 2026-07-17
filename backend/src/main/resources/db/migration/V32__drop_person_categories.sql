-- Per-person categories are replaced by tags (back-filled in V31). Drop the overlay column
-- and the table.
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_person_exercise_category')
BEGIN
    ALTER TABLE person_exercise DROP CONSTRAINT FK_person_exercise_category;
END

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('person_exercise') AND name = 'person_category_id')
BEGIN
    ALTER TABLE person_exercise DROP COLUMN person_category_id;
END

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'person_categories')
BEGIN
    DROP TABLE person_categories;
END
