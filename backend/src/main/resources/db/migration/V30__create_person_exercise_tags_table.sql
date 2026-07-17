-- Many-to-many join between a person's exercise-overlay row and the shared tags. Per person:
-- each person tags exercises independently, drawing from the account's shared vocabulary.
-- Both FKs cascade -- removing a person_exercise row (e.g. when a person is deleted) or a tag
-- clears the corresponding links. Only one cascade path reaches accounts (via tags, and that
-- FK is non-cascading), so this is safe under SQL Server's multiple-cascade-path rule.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'person_exercise_tags')
BEGIN
    CREATE TABLE person_exercise_tags (
        person_exercise_id  BIGINT NOT NULL,
        tag_id              BIGINT NOT NULL,
        CONSTRAINT PK_person_exercise_tags PRIMARY KEY (person_exercise_id, tag_id),
        CONSTRAINT FK_person_exercise_tags_pe FOREIGN KEY (person_exercise_id)
            REFERENCES person_exercise(id) ON DELETE CASCADE,
        CONSTRAINT FK_person_exercise_tags_tag FOREIGN KEY (tag_id)
            REFERENCES tags(id) ON DELETE CASCADE
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_person_exercise_tags_tag_id')
BEGIN
    CREATE INDEX IX_person_exercise_tags_tag_id ON person_exercise_tags(tag_id);
END
