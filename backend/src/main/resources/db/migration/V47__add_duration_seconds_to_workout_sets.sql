-- Seconds held for a set of a duration-tracked exercise (see V46). NULL for every strength set,
-- which is every row that exists today.
--
-- weight keeps its meaning untouched: added load, with 0 meaning bodyweight -- the convention
-- comparableLb, bodyweightOnly and prSort.isBodyweight already run on. A weighted plank is
-- weight = 25, duration_seconds = 60; it needs no new field.
--
-- reps stays INT NOT NULL and is 0 for a hold. That is not a sentinel standing in for "unknown" --
-- a hold genuinely has zero repetitions -- and it keeps every weight-based aggregate correct with
-- no null handling: volume is weight * 0 = 0, totalReps adds 0, and the row still counts as a set.
-- What marks a row as a hold is the exercise's tracking_type, NEVER reps = 0, which is also a
-- legal strength value (a failed set).
--
-- The matching CHECK constraint is V48, not this file: SQL Server cannot reference a column added
-- earlier in the same un-batched script, which is why V40/V41 and V42/V43 are split pairs too.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('workout_sets') AND name = 'duration_seconds')
BEGIN
    ALTER TABLE workout_sets ADD duration_seconds INT NULL;
END
