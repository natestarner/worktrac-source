-- Movement-pattern taxonomy that exercises are grouped by. account_id NULL means a
-- global/system category seeded for every household; non-null means a household added
-- its own custom category via Admin. Two filtered unique indexes are required (not one
-- plain unique index) because SQL Server treats each NULL as distinct, so a single
-- unique index on (account_id, name) would never actually enforce global-name uniqueness.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'categories')
BEGIN
    CREATE TABLE categories (
        id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id  BIGINT NULL,
        name        NVARCHAR(100) NOT NULL,
        created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_categories_account FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_categories_global_name')
BEGIN
    CREATE UNIQUE INDEX UX_categories_global_name ON categories(name) WHERE account_id IS NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_categories_account_name')
BEGIN
    CREATE UNIQUE INDEX UX_categories_account_name ON categories(account_id, name) WHERE account_id IS NOT NULL;
END
