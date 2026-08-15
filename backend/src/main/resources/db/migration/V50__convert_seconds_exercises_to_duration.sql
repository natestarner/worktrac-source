-- Retires the "(sec)" naming hack now that a set can be measured in seconds for real (V46-V48).
--
-- "Plank (sec)" (V7) and "Side Plank (sec)" (V34) were never rep-based exercises: the suffix was
-- there to tell the person to type seconds into the Reps field, because reps was the only number a
-- set could carry. So the stored numbers ALREADY ARE the seconds -- converting is a rename plus
-- moving reps into duration_seconds, with no interpretation and nothing lost.
--
-- Leaving them would put two Planks in the picker (a rep-tracked "Plank (sec)" beside the timed
-- exercises seeded in V49) with no visible explanation of the difference, which is exactly the
-- friction the one-entry-per-movement library exists to avoid.

-- Capture the ids BEFORE renaming -- the name is what identifies them, and it is about to change.
DECLARE @converted TABLE (id BIGINT PRIMARY KEY);

INSERT INTO @converted (id)
SELECT e.id
FROM exercises e
WHERE e.tracking_type = 'strength'
  AND (
      -- The two seeded system rows, by exact name.
      (e.account_id IS NULL AND e.name IN ('Plank (sec)', 'Side Plank (sec)'))
      -- Plus any household that copied the convention when adding its own. Scoped to a trailing
      -- suffix so an exercise merely mentioning seconds mid-name is untouched.
      OR (e.account_id IS NOT NULL AND e.name LIKE '%(sec)')
  );

-- Type first, unconditionally: every row above is a hold whatever its name ends up being.
UPDATE exercises
SET tracking_type = 'duration'
WHERE id IN (SELECT id FROM @converted);

-- Then drop the suffix, but only where the cleaned name is actually free. A household that already
-- has its own "Plank" alongside a "Plank (sec)" keeps both names distinct rather than ending up
-- with two identically-named rows in one picker; it still gets the correct measure either way.
UPDATE e
SET name = LTRIM(RTRIM(REPLACE(e.name, '(sec)', '')))
FROM exercises AS e
WHERE e.id IN (SELECT id FROM @converted)
  AND NOT EXISTS (
      SELECT 1
      FROM exercises other
      WHERE other.id <> e.id
        AND other.name = LTRIM(RTRIM(REPLACE(e.name, '(sec)', '')))
        AND (
            other.account_id = e.account_id
            OR (other.account_id IS NULL AND e.account_id IS NULL)
        )
  );

-- Finally the logged sets. In T-SQL every assignment in a SET clause reads PRE-update values, so
-- reading reps into duration_seconds while zeroing reps in the same statement is correct.
-- CK_workout_sets_duration_reps is evaluated after the statement and is satisfied (reps = 0).
--
-- `duration_seconds IS NULL` scopes this to rows logged under the old reading: anything logged
-- after V47 against a genuinely duration-tracked exercise already carries its seconds.
UPDATE ws
SET duration_seconds = ws.reps,
    reps = 0
FROM workout_sets AS ws
WHERE ws.exercise_id IN (SELECT id FROM @converted)
  AND ws.duration_seconds IS NULL;
