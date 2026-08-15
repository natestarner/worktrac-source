-- Adds the endurance/conditioning half of the system library, now that a set can be measured in
-- seconds (V46-V48). Same idempotent shape as V7/V16/V34: INSERT ... SELECT ... FROM (VALUES ...)
-- guarded by WHERE NOT EXISTS, so re-running is a no-op rather than a duplicate.
--
-- Two rules decided every row:
--   1. Things you COUNT are reps; things you SUSTAIN are time.
--   2. A hold is a different movement, not a mode. "Glute Bridge" / "Glute Bridge Hold" is a
--      legitimate pair -- two real movements. "Plank" / "Plank (Time)" would not be: one movement
--      with a mode flag bolted onto its name. Movements that genuinely go both ways (timed
--      burpees) are served by "+ Add your own exercise", which carries a Reps/Time toggle, rather
--      than by shipping two library rows whose difference the picker cannot explain.

-- Part 1: duration-tracked.
INSERT INTO exercises (account_id, name, tracking_type)
SELECT NULL, x.name, 'duration'
FROM (VALUES
    -- Holds, core
    ('High Plank'),
    ('Reverse Plank'),
    ('Hollow Body Hold'),
    ('Superman Hold'),
    ('L-Sit'),
    ('Copenhagen Plank'),
    -- Holds, upper
    ('Dead Hang'),
    ('Flexed-Arm Hang'),
    ('Handstand Hold'),
    -- Holds, lower
    ('Wall Sit'),
    ('Squat Hold'),
    ('Glute Bridge Hold'),
    -- Carries
    ('Suitcase Carry'),
    ('Overhead Carry'),
    ('Front Rack Carry'),
    ('Sled Push'),
    ('Sled Drag'),
    -- Sustained conditioning
    ('Jump Rope'),
    ('Battle Ropes'),
    ('Bear Crawl'),
    ('Crab Walk'),
    ('High Knees'),
    ('Butt Kicks'),
    ('Flutter Kick')
) AS x(name)
WHERE NOT EXISTS (
    SELECT 1 FROM exercises e WHERE e.name = x.name AND e.account_id IS NULL
);

-- Part 2: rep-tracked. Bodyweight conditioning movements the library simply never had -- there was
-- no Burpee anywhere in the repo before this. Incline Push-up and Hanging Knee Raise are here
-- deliberately as the rungs BELOW Push-up and Hanging Leg Raise: this app is used by kids who need
-- the regression, not just the standard movement.
INSERT INTO exercises (account_id, name)
SELECT NULL, x.name
FROM (VALUES
    -- Plyometric
    ('Burpee'),
    ('Jumping Jack'),
    ('Squat Jump'),
    ('Tuck Jump'),
    ('Jump Lunge'),
    ('Broad Jump'),
    ('Skater Hop'),
    -- Lower
    ('Air Squat'),
    ('Lateral Lunge'),
    -- Upper
    ('Incline Push-up'),
    ('Diamond Push-up'),
    ('Pike Push-up'),
    ('Inverted Row'),
    ('Renegade Row'),
    -- Core
    ('Sit-up'),
    ('Crunch'),
    ('Reverse Crunch'),
    ('V-Up'),
    ('Lying Leg Raise'),
    ('Hanging Knee Raise'),
    ('Toes-to-Bar'),
    ('Dead Bug'),
    ('Bird Dog'),
    ('Plank Shoulder Tap'),
    -- Compound
    ('Barbell Thruster'),
    ('Dumbbell Thruster'),
    ('Wall Ball'),
    ('Turkish Get-up')
) AS x(name)
WHERE NOT EXISTS (
    SELECT 1 FROM exercises e WHERE e.name = x.name AND e.account_id IS NULL
);

-- Part 3: Farmer's Carry (added by V34) is a carry -- reps are meaningless for it, and it should
-- have been time all along. Convert it, but ONLY if nobody has logged against it: it is a shared
-- system row, so a household that has already recorded sets under the rep reading keeps that
-- reading rather than having its history silently reinterpreted. If any household has used it,
-- everyone keeps reps, which is the safe direction.
UPDATE exercises
SET tracking_type = 'duration'
WHERE account_id IS NULL
  AND name = 'Farmer''s Carry'
  AND tracking_type = 'strength'
  AND NOT EXISTS (
      SELECT 1 FROM workout_sets ws WHERE ws.exercise_id = exercises.id
  );
