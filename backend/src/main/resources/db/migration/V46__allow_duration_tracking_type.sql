-- Widens exercises.tracking_type to admit 'duration' -- an exercise measured in seconds held
-- (plank, wall sit, dead hang, a loaded carry) rather than in repetitions.
--
-- Drops 'cardio' in the same breath. V6 reserved that value for "a future cardio type tracked by
-- duration/distance/pace", but nothing could ever have written it: Exercise has no setter for the
-- field, no constructor takes it, and no request DTO carries it. So no row can hold it, and the
-- value it reserved turned out to be the wrong shape anyway -- this change rewrites the constraint
-- and adds a column regardless. True distance/pace cardio, if it is ever built, widens this
-- constraint again the same way; nothing here has to be reworked for it.
--
-- The original constraint was declared inline on the column in V6, so SQL Server auto-named it
-- (CK__exercises__track__<hash>) and the name differs per database. Look it up by definition
-- rather than by name.
DECLARE @constraint NVARCHAR(200);

SELECT @constraint = cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('exercises')
  AND cc.definition LIKE '%tracking_type%'
  AND cc.name <> 'CK_exercises_tracking_type';

IF @constraint IS NOT NULL
BEGIN
    EXEC('ALTER TABLE exercises DROP CONSTRAINT [' + @constraint + ']');
END

-- WITH CHECK deliberately: if a row somehow holds a value outside the new set, this migration
-- should fail loudly rather than leave an untrusted constraint behind.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exercises_tracking_type')
BEGIN
    ALTER TABLE exercises WITH CHECK ADD CONSTRAINT CK_exercises_tracking_type
        CHECK (tracking_type IN ('strength', 'duration'));
END
