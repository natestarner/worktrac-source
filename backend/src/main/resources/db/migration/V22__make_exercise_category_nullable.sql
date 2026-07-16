-- Exercises no longer carry a user-facing category. Categories are now per-person
-- (person_categories) and applied via person_exercise.person_category_id, so a newly
-- "add your own" exercise is created uncategorized. Existing rows keep their old category_id
-- value harmlessly -- it's simply ignored by the UI. We relax the NOT NULL constraint rather
-- than drop the column, so nothing referencing it breaks and it can be removed later once
-- confirmed unused. The FK to categories(id) is unaffected by the nullability change.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('exercises') AND name = 'category_id' AND is_nullable = 0
)
BEGIN
    ALTER TABLE exercises ALTER COLUMN category_id BIGINT NULL;
END
