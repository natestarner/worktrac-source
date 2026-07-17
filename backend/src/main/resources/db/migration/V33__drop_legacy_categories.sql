-- The legacy shared "categories" taxonomy (exercises.category_id + the categories table) has
-- been dead since categories went per-person, and is fully superseded by tags now. Drop it.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exercises_category_id')
BEGIN
    DROP INDEX IX_exercises_category_id ON exercises;
END

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_exercises_category')
BEGIN
    ALTER TABLE exercises DROP CONSTRAINT FK_exercises_category;
END

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('exercises') AND name = 'category_id')
BEGIN
    ALTER TABLE exercises DROP COLUMN category_id;
END

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'categories')
BEGIN
    DROP TABLE categories;
END
