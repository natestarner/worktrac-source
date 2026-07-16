-- Per-person, user-created exercise categories. In the favorites model categories are no
-- longer a shared/global taxonomy stamped onto exercises -- each person builds their own
-- and files exercises into them (see person_exercise.person_category_id). Global category
-- rows in `categories` survive only as the source of category-name recommendations.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'person_categories')
BEGIN
    CREATE TABLE person_categories (
        id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        person_id   BIGINT NOT NULL,
        name        NVARCHAR(100) NOT NULL,
        sort_order  INT NOT NULL DEFAULT 0,
        created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_person_categories_person FOREIGN KEY (person_id)
            REFERENCES people(id) ON DELETE CASCADE,
        CONSTRAINT UQ_person_categories_person_name UNIQUE (person_id, name)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_person_categories_person_id')
BEGIN
    CREATE INDEX IX_person_categories_person_id ON person_categories(person_id);
END
