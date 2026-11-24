-- Which library exercises are done at bodyweight (load_type 'bodyweight', V107): the weight box
-- starts at 0 under "Added weight", and a first set is one tap. Every library exercise NOT named
-- here stays 'external': a weight is expected, so a first set starts with an empty, highlighted
-- weight box ("Enter a weight"), with "No weight, just bodyweight" for anyone who does it without.
--
-- Reviewed by Nate before shipping. The rule: bodyweight when the movement is normally done with
-- nothing in your hands (pull-ups, push-ups, dips, planks, jumps, crunches); external whenever an
-- implement is expected -- including every "Weighted ..." exercise, loaded carries and sleds, and
-- the assisted machines (their number is the machine's counterweight).
--
-- Matched by exact library name, and the migration THROWS if any name matched nothing, so a typo
-- fails every backend test instead of classifying nothing (V93's lesson).
DECLARE @bodyweight TABLE (name NVARCHAR(200) NOT NULL PRIMARY KEY);
INSERT INTO @bodyweight (name) VALUES
    -- Counted in reps
    (N'Ab Wheel Rollout'),
    (N'Air Squat'),
    (N'Bench Dip'),
    (N'Bicycle Crunch'),
    (N'Bird Dog'),
    (N'Box Jump'),
    (N'Broad Jump'),
    (N'Bulgarian Split Squat'),
    (N'Burpee'),
    (N'Chest Dip'),
    (N'Chin-up'),
    (N'Crunch'),
    (N'Dead Bug'),
    (N'Diamond Push-up'),
    (N'Exercise Ball Crunch'),
    (N'Glute Bridge'),
    (N'Hanging Knee Raise'),
    (N'Hanging Leg Raise'),
    (N'Incline Push-up'),
    (N'Inverted Row'),
    (N'Jump Lunge'),
    (N'Jumping Jack'),
    (N'Lateral Lunge'),
    (N'Lying Leg Raise'),
    (N'Mountain Climber'),
    (N'Oblique Crunch'),
    (N'Pike Push-up'),
    (N'Plank Shoulder Tap'),
    (N'Pull-up'),
    (N'Push-up'),
    (N'Reverse Crunch'),
    (N'Russian Twist'),
    (N'Sit-up'),
    (N'Skater Hop'),
    (N'Squat Jump'),
    (N'Toes-to-Bar'),
    (N'Tricep Dip'),
    (N'Tuck Jump'),
    (N'V-Up'),
    (N'Walking Lunge'),
    (N'Wide-Grip Push-up'),
    -- Measured in time
    (N'Battle Ropes'),
    (N'Bear Crawl'),
    (N'Butt Kicks'),
    (N'Copenhagen Plank'),
    (N'Crab Walk'),
    (N'Dead Hang'),
    (N'Flexed-Arm Hang'),
    (N'Flutter Kick'),
    (N'Glute Bridge Hold'),
    (N'Handstand Hold'),
    (N'High Knees'),
    (N'High Plank'),
    (N'Hollow Body Hold'),
    (N'Jump Rope'),
    (N'L-Sit'),
    (N'Plank'),
    (N'Reverse Plank'),
    (N'Side Plank'),
    (N'Squat Hold'),
    (N'Superman Hold'),
    (N'Wall Sit');

IF EXISTS (
    SELECT 1 FROM @bodyweight b
    WHERE NOT EXISTS (SELECT 1 FROM exercises e WHERE e.name = b.name AND e.account_id IS NULL)
)
    THROW 50000, 'V108: a bodyweight name is not in the library', 1;

UPDATE e
SET load_type = 'bodyweight'
FROM exercises AS e
JOIN @bodyweight AS b ON b.name = e.name
WHERE e.account_id IS NULL;

-- A household's own TIMED exercises were always "Time, with added weight" (the Add exercise screen
-- offered only Reps or Time), so they become 'bodyweight', which is what a new one made as "Time"
-- is. Their own REP exercises stay 'external': that screen never asked, and a weight box that asks
-- for a number, with "No weight, just bodyweight" under it, is the safe reading of not knowing.
UPDATE exercises
SET load_type = 'bodyweight'
WHERE account_id IS NOT NULL
  AND tracking_type = 'duration';
