-- Expands the system (account_id IS NULL) exercise library from the original 15
-- (V7/V16) to a much more comprehensive "top ~100" set, at the same granularity already
-- established: equipment/variant prefix + movement (e.g. "Barbell Bench Press", not just
-- "Bench Press"), including dedicated machine variants (Machine Chest Press, Smith Machine
-- Squat, Assisted Pull-up Machine, etc.) since the original seed skewed almost entirely
-- free-weight/cable/bodyweight.
--
-- Part 1: renames two existing system exercises to disambiguate them from new sibling
-- variants being added below, following the same precedent V16 set (e.g. "Back Squat" ->
-- "Barbell Back Squat"). Scoped to account_id IS NULL only, so a household that has
-- already forked/renamed its own copy of these keeps that copy untouched.
UPDATE exercises SET name = 'Cable Tricep Pushdown' WHERE name = 'Tricep Pushdown' AND account_id IS NULL;
UPDATE exercises SET name = 'Barbell Deadlift' WHERE name = 'Deadlift' AND account_id IS NULL;

-- Part 2: bulk insert of new system exercises, idempotent via WHERE NOT EXISTS (same
-- pattern as V7/V16) so re-running this migration or adding a name that already exists is
-- a no-op rather than a duplicate/error. tracking_type defaults to 'strength'.
INSERT INTO exercises (account_id, name)
SELECT NULL, x.name
FROM (VALUES
    -- Chest
    ('Incline Barbell Bench Press'),
    ('Decline Barbell Bench Press'),
    ('Decline Dumbbell Bench Press'),
    ('Dumbbell Chest Fly'),
    ('Cable Chest Fly'),
    ('Pec Deck Fly'),
    ('Push-up'),
    ('Chest Dip'),
    ('Assisted Dip Machine'),
    ('Cable Crossover'),
    ('Machine Chest Press'),
    ('Smith Machine Bench Press'),
    -- Shoulders
    ('Barbell Overhead Press'),
    ('Seated Barbell Shoulder Press'),
    ('Arnold Press'),
    ('Dumbbell Lateral Raise'),
    ('Cable Lateral Raise'),
    ('Machine Lateral Raise'),
    ('Dumbbell Front Raise'),
    ('Dumbbell Rear Delt Fly'),
    ('Cable Rear Delt Fly'),
    ('Machine Rear Delt Fly'),
    ('Face Pull'),
    ('Barbell Upright Row'),
    ('Machine Shoulder Press'),
    ('Smith Machine Shoulder Press'),
    ('Barbell Shrug'),
    ('Dumbbell Shrug'),
    ('Barbell Push Press'),
    -- Back
    ('Dumbbell Row'),
    ('Pendlay Row'),
    ('T-Bar Row'),
    ('Seated Cable Row'),
    ('Chest-Supported Row'),
    ('Machine Row'),
    ('Chin-up'),
    ('Assisted Pull-up Machine'),
    ('Close-Grip Lat Pulldown'),
    ('Straight-Arm Pulldown'),
    ('Single-Arm Dumbbell Row'),
    -- Biceps
    ('Barbell Bicep Curl'),
    ('EZ-Bar Bicep Curl'),
    ('Hammer Curl'),
    ('Preacher Curl'),
    ('Machine Preacher Curl'),
    ('Cable Bicep Curl'),
    ('Machine Bicep Curl'),
    ('Concentration Curl'),
    ('Incline Dumbbell Curl'),
    -- Triceps
    ('Rope Tricep Pushdown'),
    ('Overhead Dumbbell Tricep Extension'),
    ('Overhead Cable Tricep Extension'),
    ('EZ-Bar Skull Crusher'),
    ('Close-Grip Bench Press'),
    ('Tricep Dip'),
    ('Machine Tricep Extension'),
    -- Lower push (quads)
    ('Barbell Front Squat'),
    ('Smith Machine Squat'),
    ('Dumbbell Goblet Squat'),
    ('Dumbbell Reverse Lunge'),
    ('Bulgarian Split Squat'),
    ('Leg Extension'),
    ('Hack Squat'),
    ('Dumbbell Step-Up'),
    -- Lower pull (hamstrings/glutes)
    ('Romanian Deadlift'),
    ('Sumo Deadlift'),
    ('Trap Bar Deadlift'),
    ('Dumbbell Romanian Deadlift'),
    ('Lying Leg Curl'),
    ('Seated Leg Curl'),
    ('Barbell Hip Thrust'),
    ('Glute Bridge'),
    ('Barbell Good Morning'),
    ('Cable Pull-Through'),
    ('Machine Hip Abduction'),
    ('Machine Hip Adduction'),
    ('Machine Glute Kickback'),
    ('Machine Reverse Hyperextension'),
    -- Calves
    ('Standing Calf Raise'),
    ('Seated Calf Raise'),
    -- Core
    ('Cable Crunch'),
    ('Russian Twist'),
    ('Bicycle Crunch'),
    ('Weighted Sit-up'),
    ('Ab Wheel Rollout'),
    ('Side Plank (sec)'),
    ('Mountain Climber'),
    ('Cable Woodchopper'),
    ('Machine Torso Rotation'),
    -- Full body / Olympic
    ('Kettlebell Swing'),
    ('Barbell Clean'),
    ('Barbell Hang Clean'),
    ('Barbell Snatch'),
    ('Farmer''s Carry'),
    ('Box Jump'),
    ('Medicine Ball Slam')
) AS x(name)
WHERE NOT EXISTS (
    SELECT 1 FROM exercises e WHERE e.name = x.name AND e.account_id IS NULL
);
