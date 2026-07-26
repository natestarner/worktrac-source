-- Enforces at the database level that a given client idempotency key inserts at most one exercise,
-- so even a concurrent double-submit can't create a duplicate (the service's pre-check handles the
-- ordinary retry-after-timeout case; this backstops the concurrent one). Filtered to non-null keys
-- since seeded/global exercises and creates without a key legitimately have none. Mirrors V41.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_exercises_client_key' AND object_id = OBJECT_ID('exercises'))
BEGIN
    CREATE UNIQUE INDEX UX_exercises_client_key ON exercises(client_key) WHERE client_key IS NOT NULL;
END
