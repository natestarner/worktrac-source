-- Common other names for library exercises (exercise_aliases, V95), for search. Kept to names
-- lifters actually type: abbreviations (OHP, RDL, BSS), the plain name without equipment ("Back
-- Squat", "Hip Thrust"), and well-known synonyms ("Military Press", "Hex Bar Deadlift").
-- Deliberately NOT here: an alias that is itself another library exercise's name, and one alias on
-- two exercises (LibraryExerciseAliasesTest checks both), and loose synonyms that name a different
-- movement (a stiff-leg deadlift is not a Romanian deadlift).
--
-- Matched by exact library name, '|'-separated, and the migration THROWS if any name matched
-- nothing, so a typo fails every backend test instead of adding nothing (V93's lesson).
DECLARE @map TABLE (name NVARCHAR(200) NOT NULL, aliases NVARCHAR(1000) NOT NULL);
INSERT INTO @map (name, aliases) VALUES
    (N'Barbell Bench Press',            N'Bench|Bench Press|Flat Bench'),
    (N'Dumbbell Bench Press',           N'DB Bench|DB Bench Press'),
    (N'Incline DB Press',               N'Incline Dumbbell Press|Incline Dumbbell Bench Press'),
    (N'Barbell Overhead Press',         N'OHP|Military Press|Overhead Press|Standing Press|Strict Press'),
    (N'Dumbbell Overhead Press',        N'Dumbbell Shoulder Press|DB Shoulder Press'),
    (N'Barbell Back Squat',             N'Back Squat|Squat|High-Bar Squat|Low-Bar Squat'),
    (N'Barbell Front Squat',            N'Front Squat'),
    (N'Barbell Deadlift',               N'Deadlift|Conventional Deadlift'),
    (N'Romanian Deadlift',              N'RDL'),
    (N'Dumbbell Romanian Deadlift',     N'DB RDL|Dumbbell RDL'),
    (N'Trap Bar Deadlift',              N'Hex Bar Deadlift'),
    (N'Barbell Row',                    N'Bent-Over Row|Bent-Over Barbell Row'),
    (N'Single-Arm Dumbbell Row',        N'One-Arm Dumbbell Row|One-Arm Row'),
    (N'Seated Cable Row',               N'Cable Row|Low Row'),
    (N'Pull-up',                        N'Pullup|Pull Up'),
    (N'Chin-up',                        N'Chinup|Chin Up'),
    (N'Push-up',                        N'Pushup|Press-up'),
    (N'Lat Pulldown',                   N'Pulldown|Lat Pull-down'),
    (N'Straight-Arm Pulldown',          N'Lat Pushdown'),
    (N'Dumbbell Bicep Curl',            N'Dumbbell Curl|DB Curl|Bicep Curl'),
    (N'Barbell Bicep Curl',             N'Barbell Curl'),
    (N'EZ-Bar Bicep Curl',              N'EZ Bar Curl|EZ Curl'),
    (N'EZ-Bar Skull Crusher',           N'Skull Crusher|Skullcrusher|Lying Tricep Extension'),
    (N'Cable Tricep Pushdown',          N'Tricep Pushdown|Triceps Pushdown'),
    (N'Rope Tricep Pushdown',           N'Rope Pushdown'),
    (N'Close-Grip Bench Press',         N'CGBP|Close Grip Bench'),
    (N'Dumbbell Lateral Raise',         N'Lateral Raise|Side Raise|Side Lateral Raise'),
    (N'Dumbbell Rear Delt Fly',         N'Reverse Fly|Rear Delt Raise'),
    (N'Pec Deck Fly',                   N'Pec Deck|Machine Fly'),
    (N'Barbell Upright Row',            N'Upright Row'),
    (N'Barbell Shrug',                  N'Shrug'),
    (N'Dumbbell Goblet Squat',          N'Goblet Squat'),
    (N'Bulgarian Split Squat',          N'BSS|Rear-Foot-Elevated Split Squat|RFESS'),
    (N'Barbell Hip Thrust',             N'Hip Thrust'),
    (N'Barbell Good Morning',           N'Good Morning'),
    (N'Cable Pull-Through',             N'Pull-Through'),
    (N'Lying Leg Curl',                 N'Hamstring Curl'),
    (N'Leg Extension',                  N'Quad Extension'),
    (N'Standing Calf Raise',            N'Calf Raise'),
    (N'Hanging Leg Raise',              N'Leg Raise'),
    (N'Ab Wheel Rollout',               N'Ab Rollout|Ab Wheel'),
    (N'Kettlebell Swing',               N'KB Swing'),
    (N'Farmer''s Carry',                N'Farmer''s Walk|Farmers Walk|Farmer Carry'),
    (N'Turkish Get-up',                 N'TGU|Get-up'),
    (N'Toes-to-Bar',                    N'T2B|TTB'),
    (N'Wall Ball',                      N'Wall Ball Shot'),
    (N'Jumping Jack',                   N'Star Jump');

INSERT INTO exercise_aliases (exercise_id, alias)
SELECT e.id, LTRIM(RTRIM(s.value))
FROM @map AS m
JOIN exercises AS e ON e.name = m.name AND e.account_id IS NULL
CROSS APPLY STRING_SPLIT(m.aliases, '|') AS s
WHERE LTRIM(RTRIM(s.value)) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM exercise_aliases a
      WHERE a.exercise_id = e.id AND a.alias = LTRIM(RTRIM(s.value))
  );

IF EXISTS (
    SELECT 1 FROM @map m
    WHERE NOT EXISTS (SELECT 1 FROM exercises e WHERE e.name = m.name AND e.account_id IS NULL)
)
    THROW 50000, 'V96: an alias names an exercise that is not in the library', 1;
