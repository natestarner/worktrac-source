-- Enforces at the database level that a given client idempotency key inserts at most one set, so
-- even a concurrent double-submit can't create a duplicate (the service's pre-check handles the
-- ordinary retry-after-timeout case; this backstops the concurrent one). Filtered to non-null keys
-- since historical rows and writes without a key legitimately have none.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_workout_sets_client_key' AND object_id = OBJECT_ID('workout_sets'))
BEGIN
    CREATE UNIQUE INDEX UX_workout_sets_client_key ON workout_sets(client_key) WHERE client_key IS NOT NULL;
END
