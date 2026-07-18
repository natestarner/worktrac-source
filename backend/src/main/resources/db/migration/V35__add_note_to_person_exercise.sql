-- A standing, per-person reminder for an exercise (e.g. "keep elbows tucked", "go light --
-- bad knee"), shown every time this person does the exercise, in every session. Lives on
-- person_exercise (not the shared exercises row) so it stays private to this person the
-- same way is_favorite already does -- Nate's note never leaks onto his sons' screens.
-- Distinct from the per-session note added in V36: this one persists across sessions,
-- that one is scoped to a single workout.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('person_exercise') AND name = 'note')
BEGIN
    ALTER TABLE person_exercise ADD note NVARCHAR(1000) NULL;
END
