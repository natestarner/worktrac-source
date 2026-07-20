-- A client-generated idempotency key for a logged set. Lets a retried or offline-replayed
-- log-set request be deduped rather than inserting a duplicate (see WorkoutSetService.findDuplicate).
-- Nullable: historical rows and any write that doesn't supply one simply aren't deduped. The
-- uniqueness guarantee is added separately in V41 (SQL Server can't reference a column added
-- earlier in the same un-batched script).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('workout_sets') AND name = 'client_key')
BEGIN
    ALTER TABLE workout_sets ADD client_key NVARCHAR(64) NULL;
END
