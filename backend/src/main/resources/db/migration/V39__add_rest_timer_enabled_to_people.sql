-- Whether the on-screen rest timer is shown for this person. A per-person preference (some
-- household members want it, some don't) but persisted server-side and account-visible, so the
-- Settings screen can show every person's toggle at once and the choice syncs across devices --
-- replacing the old per-device localStorage flag. This only controls DISPLAY of the timer;
-- rest_seconds is always recorded regardless (see WorkoutSetService.computeRestSeconds). Defaults
-- on, matching the prior localStorage default.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('people') AND name = 'rest_timer_enabled')
BEGIN
    ALTER TABLE people ADD rest_timer_enabled BIT NOT NULL CONSTRAINT DF_people_rest_timer_enabled DEFAULT 1;
END
