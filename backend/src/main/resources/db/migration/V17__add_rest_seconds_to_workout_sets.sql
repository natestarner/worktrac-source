-- Seconds of rest taken before this set, for the future Trends "rest between sets"
-- feature. NULL unless ALL of the following hold:
--   1. This is not the first set of this exercise logged in this session (nothing to
--      diff against).
--   2. The set was logged through the live-session path (WorkoutSetService.logLiveSet),
--      never through logSetIntoSession (retroactive/"editing a past session" sets --
--      manual or resumed-live -- have no trustworthy real-time gap between rows).
-- Computed once at insert time from the previous set's created_at for the same
-- session_id + exercise_id; never recomputed afterward (editing or deleting a later/
-- earlier set does not retroactively update this column -- see WorkoutSet.java and
-- WorkoutSetService.java for the full rule, and CLAUDE.md's Data Model Notes).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('workout_sets') AND name = 'rest_seconds')
BEGIN
    ALTER TABLE workout_sets ADD rest_seconds INT NULL;
END
