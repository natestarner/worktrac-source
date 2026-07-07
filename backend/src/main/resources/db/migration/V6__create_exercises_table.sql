-- Exercise library. account_id NULL means a system exercise shared by every household;
-- non-null means a household-added custom exercise. tracking_type is a forward-looking
-- discriminator (strength vs. a future cardio type tracked by duration/distance/pace
-- instead of weight/reps) -- unused beyond 'strength' until cardio is actually built, but
-- present now so that addition won't require a schema rework later. is_deleted is a
-- soft-delete flag: exercises are referenced by historical sets and routines, so "Delete
-- exercise" in Admin hides it from pickers without breaking FK integrity or history.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'exercises')
BEGIN
    CREATE TABLE exercises (
        id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id     BIGINT NULL,
        category_id    BIGINT NOT NULL,
        name           NVARCHAR(200) NOT NULL,
        tracking_type  NVARCHAR(20) NOT NULL DEFAULT 'strength' CHECK (tracking_type IN ('strength', 'cardio')),
        is_deleted     BIT NOT NULL DEFAULT 0,
        created_at     DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_exercises_account FOREIGN KEY (account_id) REFERENCES accounts(id),
        CONSTRAINT FK_exercises_category FOREIGN KEY (category_id) REFERENCES categories(id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exercises_account_id')
BEGIN
    CREATE INDEX IX_exercises_account_id ON exercises(account_id);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exercises_category_id')
BEGIN
    CREATE INDEX IX_exercises_category_id ON exercises(category_id);
END
