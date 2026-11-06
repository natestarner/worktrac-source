-- Muscles worked for the fifty exercises V98 added, in V93's shape (primary CSV, secondary CSV),
-- described the way V93 described each one's closest relative (a fly like Dumbbell Chest Fly, a lunge
-- like Walking Lunge). Throws if a name matches no library exercise, so a typo fails every backend
-- test instead of leaving an exercise undescribed (LibraryExerciseMusclesTest would also notice).
DECLARE @map TABLE (name NVARCHAR(200) NOT NULL, prim NVARCHAR(200) NOT NULL, sec NVARCHAR(200) NOT NULL);
INSERT INTO @map (name, prim, sec) VALUES
    (N'Seated Cable Crunch', N'abs', N'obliques'),
    (N'Exercise Ball Crunch', N'abs', N'obliques'),
    (N'Oblique Crunch', N'obliques', N'abs'),
    (N'Cable Preacher Curl', N'biceps', N''),
    (N'Close-Grip EZ-Bar Curl', N'biceps', N'forearms'),
    (N'Cross-Body Hammer Curl', N'biceps', N'forearms'),
    (N'Incline Hammer Curl', N'biceps', N'forearms'),
    (N'Single-Arm Dumbbell Preacher Curl', N'biceps', N''),
    (N'Reverse-Grip EZ-Bar Curl', N'forearms,biceps', N''),
    (N'Reverse-Grip Cable Curl', N'forearms,biceps', N''),
    (N'Seated Dumbbell Curl', N'biceps', N'forearms'),
    (N'Spider Curl', N'biceps', N''),
    (N'Single-Arm Cable Curl', N'biceps', N'forearms'),
    (N'Zottman Curl', N'biceps,forearms', N''),
    (N'Smith Machine Calf Raise', N'calves', N''),
    (N'Cable Chest Press', N'chest', N'triceps,shoulders'),
    (N'Decline Dumbbell Fly', N'chest', N'shoulders'),
    (N'Incline Dumbbell Fly', N'chest', N'shoulders'),
    (N'Incline Cable Fly', N'chest', N'shoulders'),
    (N'Single-Arm Dumbbell Bench Press', N'chest', N'triceps,shoulders,obliques'),
    (N'Wide-Grip Push-up', N'chest', N'shoulders,triceps,abs'),
    (N'Decline Smith Machine Bench Press', N'chest', N'triceps,shoulders'),
    (N'Close-Grip Dumbbell Press', N'chest,triceps', N'shoulders'),
    (N'Dumbbell Floor Press', N'chest,triceps', N'shoulders'),
    (N'Barbell Floor Press', N'chest,triceps', N'shoulders'),
    (N'Dumbbell Wrist Curl', N'forearms', N''),
    (N'Barbell Stiff-Leg Deadlift', N'hamstrings,glutes', N'lower_back,forearms'),
    (N'Barbell Walking Lunge', N'quads,glutes', N'hamstrings,adductors'),
    (N'Barbell Lunge', N'quads,glutes', N'hamstrings,adductors'),
    (N'Dumbbell Lunge', N'quads,glutes', N'hamstrings,adductors'),
    (N'Dumbbell Squat', N'quads,glutes', N'hamstrings,adductors'),
    (N'Single-Leg Leg Extension', N'quads', N''),
    (N'Barbell Hack Squat', N'quads,glutes', N'hamstrings,forearms'),
    (N'Barbell Step-Up', N'quads,glutes', N'hamstrings'),
    (N'Box Squat', N'quads,glutes', N'hamstrings,adductors,lower_back'),
    (N'Overhead Squat', N'quads,glutes', N'shoulders,abs,upper_back,lower_back'),
    (N'Weighted Sissy Squat', N'quads', N''),
    (N'Cable Hip Adduction', N'adductors', N''),
    (N'Cable Front Raise', N'shoulders', N'chest'),
    (N'Single-Arm Dumbbell Shoulder Press', N'shoulders', N'triceps,obliques'),
    (N'Barbell Clean and Press', N'shoulders,glutes,hamstrings,quads', N'traps,triceps,upper_back,lower_back'),
    (N'Smith Machine Upright Row', N'shoulders,traps', N'biceps'),
    (N'Dumbbell Upright Row', N'shoulders,traps', N'biceps'),
    (N'Cable Upright Row', N'shoulders,traps', N'biceps'),
    (N'Cable Shrug', N'traps', N'forearms'),
    (N'Bench Dip', N'triceps', N'chest,shoulders'),
    (N'Single-Arm Cable Tricep Extension', N'triceps', N''),
    (N'Single-Arm Overhead Dumbbell Tricep Extension', N'triceps', N''),
    (N'Dumbbell Tricep Kickback', N'triceps', N''),
    (N'Single-Arm Seated Cable Row', N'upper_back,lats', N'biceps,rear_delts');

INSERT INTO exercise_muscles (exercise_id, muscle_code, role)
SELECT e.id, LTRIM(RTRIM(s.value)), r.role
FROM @map AS m
JOIN exercises AS e ON e.name = m.name AND e.account_id IS NULL
CROSS APPLY (VALUES ('primary', m.prim), ('secondary', m.sec)) AS r(role, list)
CROSS APPLY STRING_SPLIT(r.list, ',') AS s
WHERE LTRIM(RTRIM(s.value)) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM exercise_muscles em
      WHERE em.exercise_id = e.id AND em.muscle_code = LTRIM(RTRIM(s.value))
  );

IF EXISTS (
    SELECT 1 FROM @map m
    WHERE NOT EXISTS (SELECT 1 FROM exercises e WHERE e.name = m.name AND e.account_id IS NULL)
)
    THROW 50000, 'V99: muscles name an exercise that is not in the library', 1;
