-- A client-generated idempotency key for a user-created exercise. Lets an offline-created exercise
-- whose create is retried/replayed be deduped rather than inserting a duplicate row (see
-- ExerciseService.add). Nullable: seeded/global exercises and any create that doesn't supply one
-- simply aren't deduped. Mirrors workout_sets.client_key (V40); the uniqueness guarantee is added
-- separately in V43 (SQL Server can't reference a column added earlier in the same un-batched script).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('exercises') AND name = 'client_key')
BEGIN
    ALTER TABLE exercises ADD client_key NVARCHAR(64) NULL;
END
