-- A household/tenant. Every Person, and every account-custom Category/Exercise, belongs
-- to exactly one Account. default_unit is the household-wide lb/kg default applied to
-- newly logged sets (Admin > Units) -- it lives here, not as unscoped global app state.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounts')
BEGIN
    CREATE TABLE accounts (
        id            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        name          NVARCHAR(200) NOT NULL,
        default_unit  NVARCHAR(2) NOT NULL DEFAULT 'lb' CHECK (default_unit IN ('lb', 'kg')),
        created_at    DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END
