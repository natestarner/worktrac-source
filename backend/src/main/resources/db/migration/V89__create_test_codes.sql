-- The raw verification / password-reset code per email, for the local- and lower-only test-support
-- endpoint (user.TestCodeCache, GET /api/auth/test/pending-code) that hands codes to Playwright e2e.
--
-- It was an in-memory map, which only worked while one JVM served both the request that issued a
-- code and the e2e's request to read it back. With several replicas -- and even with one, during
-- lower's scale-from-zero, when ACA can briefly run two instances -- the read lands elsewhere and
-- finds nothing. In the database every replica sees the same codes.
--
-- PRODUCTION NEVER WRITES HERE: TestCodeCache is a bean only under the local and lower profiles, so
-- in production this table exists and stays empty. Only the BCrypt hash of a code is ever stored in
-- pending_registrations / password_reset_codes; this table is test-environment-only by construction.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'test_codes')
BEGIN
    CREATE TABLE test_codes (
        email      NVARCHAR(320) NOT NULL,
        code       NVARCHAR(32)  NOT NULL,
        created_at DATETIME2     NOT NULL CONSTRAINT DF_test_codes_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_test_codes PRIMARY KEY (email)
    );
END
