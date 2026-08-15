-- A set records exactly one measure: reps, or seconds held. Separate file from V47 because
-- SQL Server cannot reference a column added earlier in the same un-batched script.
--
-- Deliberately one-directional. It cannot also assert "a duration-tracked exercise's sets always
-- carry duration_seconds", because that is a cross-table condition on exercises.tracking_type and
-- T-SQL cannot express it in a CHECK -- the same reason workout_sets.person_id matching its
-- session's person is a service-layer invariant (see V13). WorkoutSetService enforces the other
-- direction.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_workout_sets_duration_reps')
BEGIN
    ALTER TABLE workout_sets WITH CHECK ADD CONSTRAINT CK_workout_sets_duration_reps
        CHECK (duration_seconds IS NULL OR reps = 0);
END
