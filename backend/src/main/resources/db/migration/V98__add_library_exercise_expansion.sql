-- Fifty more library exercises (2026-11-06), chosen by hand from the free-exercise-db dataset
-- (Unlicense; names and muscle facts only) where Muscle & Strength has an exercise of the same
-- movement, and approved by Nate. Huddle's own naming: equipment first, "Single-Arm" for one-arm.
-- Their muscles are V99, their other names V100, the videos that can be embedded V101.
--
-- Idempotent like V34 (WHERE NOT EXISTS on a library row of the same name). A household that already
-- made its own exercise with one of these names keeps it; the picker's search shows the household's
-- row rather than both (utils/exerciseSearch.js), the same preference creating one applies.
INSERT INTO exercises (account_id, name)
SELECT NULL, x.name
FROM (VALUES
    (N'Seated Cable Crunch'),
    (N'Exercise Ball Crunch'),
    (N'Oblique Crunch'),
    (N'Cable Preacher Curl'),
    (N'Close-Grip EZ-Bar Curl'),
    (N'Cross-Body Hammer Curl'),
    (N'Incline Hammer Curl'),
    (N'Single-Arm Dumbbell Preacher Curl'),
    (N'Reverse-Grip EZ-Bar Curl'),
    (N'Reverse-Grip Cable Curl'),
    (N'Seated Dumbbell Curl'),
    (N'Spider Curl'),
    (N'Single-Arm Cable Curl'),
    (N'Zottman Curl'),
    (N'Smith Machine Calf Raise'),
    (N'Cable Chest Press'),
    (N'Decline Dumbbell Fly'),
    (N'Incline Dumbbell Fly'),
    (N'Incline Cable Fly'),
    (N'Single-Arm Dumbbell Bench Press'),
    (N'Wide-Grip Push-up'),
    (N'Decline Smith Machine Bench Press'),
    (N'Close-Grip Dumbbell Press'),
    (N'Dumbbell Floor Press'),
    (N'Barbell Floor Press'),
    (N'Dumbbell Wrist Curl'),
    (N'Barbell Stiff-Leg Deadlift'),
    (N'Barbell Walking Lunge'),
    (N'Barbell Lunge'),
    (N'Dumbbell Lunge'),
    (N'Dumbbell Squat'),
    (N'Single-Leg Leg Extension'),
    (N'Barbell Hack Squat'),
    (N'Barbell Step-Up'),
    (N'Box Squat'),
    (N'Overhead Squat'),
    (N'Weighted Sissy Squat'),
    (N'Cable Hip Adduction'),
    (N'Cable Front Raise'),
    (N'Single-Arm Dumbbell Shoulder Press'),
    (N'Barbell Clean and Press'),
    (N'Smith Machine Upright Row'),
    (N'Dumbbell Upright Row'),
    (N'Cable Upright Row'),
    (N'Cable Shrug'),
    (N'Bench Dip'),
    (N'Single-Arm Cable Tricep Extension'),
    (N'Single-Arm Overhead Dumbbell Tricep Extension'),
    (N'Dumbbell Tricep Kickback'),
    (N'Single-Arm Seated Cable Row')
) AS x(name)
WHERE NOT EXISTS (SELECT 1 FROM exercises e WHERE e.name = x.name AND e.account_id IS NULL);
