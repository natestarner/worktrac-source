-- Other names for the V98 exercises that lifters actually type, in V96's shape ('|'-separated).
-- Same hygiene as V96: no alias is another library exercise's name or sits on two exercises
-- (LibraryExerciseAliasesTest), and the migration throws on a name that matches nothing.
DECLARE @map TABLE (name NVARCHAR(200) NOT NULL, aliases NVARCHAR(1000) NOT NULL);
INSERT INTO @map (name, aliases) VALUES
    (N'Exercise Ball Crunch', N'Swiss Ball Crunch|Stability Ball Crunch'),
    (N'Oblique Crunch', N'Side Crunch'),
    (N'Cross-Body Hammer Curl', N'Pinwheel Curl'),
    (N'Single-Arm Dumbbell Preacher Curl', N'One-Arm Preacher Curl'),
    (N'Reverse-Grip EZ-Bar Curl', N'Reverse Curl|EZ-Bar Reverse Curl'),
    (N'Reverse-Grip Cable Curl', N'Reverse Cable Curl'),
    (N'Single-Arm Cable Curl', N'One-Arm Cable Curl'),
    (N'Single-Arm Dumbbell Bench Press', N'One-Arm Dumbbell Bench Press'),
    (N'Wide-Grip Push-up', N'Wide Push-up'),
    (N'Close-Grip Dumbbell Press', N'Crush Press|Dumbbell Crush Press'),
    (N'Barbell Floor Press', N'Floor Press'),
    (N'Dumbbell Wrist Curl', N'Wrist Curl'),
    (N'Barbell Stiff-Leg Deadlift', N'Stiff-Leg Deadlift|Stiff-Legged Deadlift|SLDL'),
    (N'Overhead Squat', N'OHS'),
    (N'Weighted Sissy Squat', N'Sissy Squat'),
    (N'Single-Arm Dumbbell Shoulder Press', N'One-Arm Dumbbell Shoulder Press'),
    (N'Barbell Clean and Press', N'Clean and Press'),
    (N'Bench Dip', N'Bench Dips'),
    (N'Single-Arm Cable Tricep Extension', N'One-Arm Cable Pushdown'),
    (N'Single-Arm Overhead Dumbbell Tricep Extension', N'One-Arm Overhead Tricep Extension'),
    (N'Dumbbell Tricep Kickback', N'Tricep Kickback|Triceps Kickback'),
    (N'Single-Arm Seated Cable Row', N'One-Arm Cable Row');

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
    THROW 50000, 'V100: an alias names an exercise that is not in the library', 1;
