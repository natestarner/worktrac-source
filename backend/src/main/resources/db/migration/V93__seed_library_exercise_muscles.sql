-- Muscles worked for every library exercise seeded so far (V7, V16, V34, V49, renamed by V16, V34
-- and V50). One row per exercise: primary muscles, then secondary muscles, each a comma-separated
-- list of muscles.code (V91). Matched by name against library rows only (account_id IS NULL), so a
-- household's own exercise of the same name is never touched.
--
-- How the calls were made:
--   * primary   = what the movement is FOR -- what a lifter would say it trains;
--   * secondary = real helpers, not every muscle that is merely awake (stabilisers are omitted
--     unless they visibly limit the lift, e.g. forearms on a deadlift);
--   * conditioning that no muscle list describes honestly (jump rope, burpee, bear crawl) is
--     'cardio' or 'full_body', which are display labels and count toward no muscle (V90).
--
-- Idempotent: each pair is inserted only if that exercise does not have that muscle yet.
-- LibraryExerciseMusclesTest requires every live library exercise to end up with a primary muscle,
-- so a name typo here (which would silently match nothing) fails the build rather than shipping
-- an exercise with no muscles.
DECLARE @map TABLE (name NVARCHAR(200) NOT NULL, prim NVARCHAR(200) NOT NULL, sec NVARCHAR(200) NOT NULL);

INSERT INTO @map (name, prim, sec) VALUES
    -- V7 / V16 originals
    ('Barbell Bench Press',            'chest',                        'triceps,shoulders'),
    ('Dumbbell Bench Press',           'chest',                        'triceps,shoulders'),
    ('Incline DB Press',               'chest',                        'shoulders,triceps'),
    ('Dumbbell Overhead Press',        'shoulders',                    'triceps,traps'),
    ('Cable Tricep Pushdown',          'triceps',                      ''),
    ('Barbell Row',                    'upper_back,lats',              'biceps,rear_delts,lower_back'),
    ('Pull-up',                        'lats',                         'biceps,upper_back,forearms'),
    ('Lat Pulldown',                   'lats',                         'biceps,upper_back'),
    ('Dumbbell Bicep Curl',            'biceps',                       'forearms'),
    ('Barbell Back Squat',             'quads,glutes',                 'hamstrings,adductors,lower_back'),
    ('Leg Press',                      'quads,glutes',                 'hamstrings'),
    ('Walking Lunge',                  'quads,glutes',                 'hamstrings,adductors'),
    ('Barbell Deadlift',               'hamstrings,glutes,lower_back', 'quads,upper_back,traps,forearms'),
    ('Plank',                          'abs',                          'obliques,shoulders'),
    ('Hanging Leg Raise',              'abs',                          'hip_flexors,obliques,forearms'),
    -- V34: chest
    ('Incline Barbell Bench Press',    'chest',                        'shoulders,triceps'),
    ('Decline Barbell Bench Press',    'chest',                        'triceps'),
    ('Decline Dumbbell Bench Press',   'chest',                        'triceps'),
    ('Dumbbell Chest Fly',             'chest',                        'shoulders'),
    ('Cable Chest Fly',                'chest',                        'shoulders'),
    ('Pec Deck Fly',                   'chest',                        ''),
    ('Push-up',                        'chest',                        'triceps,shoulders,abs'),
    ('Chest Dip',                      'chest',                        'triceps,shoulders'),
    ('Assisted Dip Machine',           'chest,triceps',                'shoulders'),
    ('Cable Crossover',                'chest',                        'shoulders'),
    ('Machine Chest Press',            'chest',                        'triceps,shoulders'),
    ('Smith Machine Bench Press',      'chest',                        'triceps,shoulders'),
    -- V34: shoulders
    ('Barbell Overhead Press',         'shoulders',                    'triceps,traps,abs'),
    ('Seated Barbell Shoulder Press',  'shoulders',                    'triceps'),
    ('Arnold Press',                   'shoulders',                    'triceps'),
    ('Dumbbell Lateral Raise',         'shoulders',                    'traps'),
    ('Cable Lateral Raise',            'shoulders',                    'traps'),
    ('Machine Lateral Raise',          'shoulders',                    ''),
    ('Dumbbell Front Raise',           'shoulders',                    'chest'),
    ('Dumbbell Rear Delt Fly',         'rear_delts',                   'upper_back,traps'),
    ('Cable Rear Delt Fly',            'rear_delts',                   'upper_back'),
    ('Machine Rear Delt Fly',          'rear_delts',                   'upper_back'),
    ('Face Pull',                      'rear_delts',                   'upper_back,traps'),
    ('Barbell Upright Row',            'shoulders,traps',              'biceps'),
    ('Machine Shoulder Press',         'shoulders',                    'triceps'),
    ('Smith Machine Shoulder Press',   'shoulders',                    'triceps'),
    ('Barbell Shrug',                  'traps',                        'forearms'),
    ('Dumbbell Shrug',                 'traps',                        'forearms'),
    ('Barbell Push Press',             'shoulders',                    'triceps,traps,quads,glutes'),
    -- V34: back
    ('Dumbbell Row',                   'lats,upper_back',              'biceps,rear_delts'),
    ('Pendlay Row',                    'upper_back,lats',              'biceps,rear_delts,lower_back'),
    ('T-Bar Row',                      'upper_back,lats',              'biceps,rear_delts'),
    ('Seated Cable Row',               'upper_back,lats',              'biceps,rear_delts'),
    ('Chest-Supported Row',            'upper_back,lats',              'biceps,rear_delts'),
    ('Machine Row',                    'upper_back,lats',              'biceps'),
    ('Chin-up',                        'lats',                         'biceps,upper_back'),
    ('Assisted Pull-up Machine',       'lats',                         'biceps,upper_back'),
    ('Close-Grip Lat Pulldown',        'lats',                         'biceps,upper_back'),
    ('Straight-Arm Pulldown',          'lats',                         'triceps'),
    ('Single-Arm Dumbbell Row',        'lats,upper_back',              'biceps,rear_delts'),
    -- V34: biceps
    ('Barbell Bicep Curl',             'biceps',                       'forearms'),
    ('EZ-Bar Bicep Curl',              'biceps',                       'forearms'),
    ('Hammer Curl',                    'biceps',                       'forearms'),
    ('Preacher Curl',                  'biceps',                       ''),
    ('Machine Preacher Curl',          'biceps',                       ''),
    ('Cable Bicep Curl',               'biceps',                       'forearms'),
    ('Machine Bicep Curl',             'biceps',                       ''),
    ('Concentration Curl',             'biceps',                       ''),
    ('Incline Dumbbell Curl',          'biceps',                       ''),
    -- V34: triceps
    ('Rope Tricep Pushdown',           'triceps',                      ''),
    ('Overhead Dumbbell Tricep Extension', 'triceps',                  ''),
    ('Overhead Cable Tricep Extension','triceps',                      ''),
    ('EZ-Bar Skull Crusher',           'triceps',                      ''),
    ('Close-Grip Bench Press',         'triceps',                      'chest,shoulders'),
    ('Tricep Dip',                     'triceps',                      'chest,shoulders'),
    ('Machine Tricep Extension',       'triceps',                      ''),
    -- V34: quads
    ('Barbell Front Squat',            'quads',                        'glutes,abs,upper_back'),
    ('Smith Machine Squat',            'quads,glutes',                 'hamstrings'),
    ('Dumbbell Goblet Squat',          'quads,glutes',                 'adductors,abs'),
    ('Dumbbell Reverse Lunge',         'quads,glutes',                 'hamstrings,adductors'),
    ('Bulgarian Split Squat',          'quads,glutes',                 'hamstrings,adductors'),
    ('Leg Extension',                  'quads',                        ''),
    ('Hack Squat',                     'quads',                        'glutes'),
    ('Dumbbell Step-Up',               'quads,glutes',                 'hamstrings'),
    -- V34: hamstrings / glutes
    ('Romanian Deadlift',              'hamstrings,glutes',            'lower_back,forearms'),
    ('Sumo Deadlift',                  'glutes,hamstrings',            'quads,adductors,lower_back,traps'),
    ('Trap Bar Deadlift',              'quads,glutes,hamstrings',      'lower_back,traps,forearms'),
    ('Dumbbell Romanian Deadlift',     'hamstrings,glutes',            'lower_back'),
    ('Lying Leg Curl',                 'hamstrings',                   'calves'),
    ('Seated Leg Curl',                'hamstrings',                   'calves'),
    ('Barbell Hip Thrust',             'glutes',                       'hamstrings'),
    ('Glute Bridge',                   'glutes',                       'hamstrings'),
    ('Barbell Good Morning',           'hamstrings,lower_back',        'glutes'),
    ('Cable Pull-Through',             'glutes',                       'hamstrings'),
    ('Machine Hip Abduction',          'abductors',                    'glutes'),
    ('Machine Hip Adduction',          'adductors',                    ''),
    ('Machine Glute Kickback',         'glutes',                       'hamstrings'),
    ('Machine Reverse Hyperextension', 'glutes',                       'hamstrings,lower_back'),
    -- V34: calves
    ('Standing Calf Raise',            'calves',                       ''),
    ('Seated Calf Raise',              'calves',                       ''),
    -- V34: core
    ('Cable Crunch',                   'abs',                          'obliques'),
    ('Russian Twist',                  'obliques',                     'abs'),
    ('Bicycle Crunch',                 'abs,obliques',                 'hip_flexors'),
    ('Weighted Sit-up',                'abs',                          'hip_flexors'),
    ('Ab Wheel Rollout',               'abs',                          'lats,shoulders'),
    ('Side Plank',                     'obliques',                     'abs'),
    ('Mountain Climber',               'abs',                          'shoulders,hip_flexors,cardio'),
    ('Cable Woodchopper',              'obliques',                     'abs,shoulders'),
    ('Machine Torso Rotation',         'obliques',                     'abs'),
    -- V34: full body / Olympic
    ('Kettlebell Swing',               'glutes,hamstrings',            'lower_back,shoulders,abs'),
    ('Barbell Clean',                  'glutes,hamstrings,quads,traps','shoulders,upper_back,lower_back,forearms'),
    ('Barbell Hang Clean',             'glutes,hamstrings,traps',      'quads,shoulders,upper_back,forearms'),
    ('Barbell Snatch',                 'glutes,hamstrings,quads,shoulders', 'traps,upper_back,lower_back,triceps'),
    ('Farmer''s Carry',                'forearms,traps',               'abs,obliques,quads'),
    ('Box Jump',                       'quads,glutes',                 'hamstrings,calves,cardio'),
    ('Medicine Ball Slam',             'abs,lats',                     'shoulders,triceps,cardio'),
    -- V49: holds
    ('High Plank',                     'abs',                          'shoulders,chest'),
    ('Reverse Plank',                  'glutes,lower_back',            'hamstrings,shoulders'),
    ('Hollow Body Hold',               'abs',                          'hip_flexors,obliques'),
    ('Superman Hold',                  'lower_back',                   'glutes,upper_back'),
    ('L-Sit',                          'abs,hip_flexors',              'triceps,quads'),
    ('Copenhagen Plank',               'adductors,obliques',           'abs'),
    ('Dead Hang',                      'forearms',                     'lats,shoulders'),
    ('Flexed-Arm Hang',                'biceps,lats',                  'forearms,upper_back'),
    ('Handstand Hold',                 'shoulders',                    'triceps,traps,abs'),
    ('Wall Sit',                       'quads',                        'glutes'),
    ('Squat Hold',                     'quads,glutes',                 'adductors'),
    ('Glute Bridge Hold',              'glutes',                       'hamstrings'),
    -- V49: carries and sleds
    ('Suitcase Carry',                 'obliques,forearms',            'traps,abs'),
    ('Overhead Carry',                 'shoulders',                    'traps,triceps,abs'),
    ('Front Rack Carry',               'abs,upper_back',               'shoulders,forearms'),
    ('Sled Push',                      'quads,glutes',                 'calves,hamstrings,cardio'),
    ('Sled Drag',                      'quads,glutes',                 'hamstrings,calves,cardio'),
    -- V49: sustained conditioning
    ('Jump Rope',                      'cardio',                       'calves'),
    ('Battle Ropes',                   'cardio',                       'shoulders,forearms,abs'),
    ('Bear Crawl',                     'full_body',                    'shoulders,quads,abs'),
    ('Crab Walk',                      'full_body',                    'triceps,shoulders,glutes'),
    ('High Knees',                     'cardio',                       'hip_flexors,quads,calves'),
    ('Butt Kicks',                     'cardio',                       'hamstrings,calves'),
    ('Flutter Kick',                   'abs',                          'hip_flexors'),
    -- V49: plyometric
    ('Burpee',                         'full_body',                    'chest,quads,triceps,cardio'),
    ('Jumping Jack',                   'cardio',                       'calves,shoulders'),
    ('Squat Jump',                     'quads,glutes',                 'calves,cardio'),
    ('Tuck Jump',                      'quads,glutes',                 'calves,abs,cardio'),
    ('Jump Lunge',                     'quads,glutes',                 'hamstrings,calves,cardio'),
    ('Broad Jump',                     'quads,glutes',                 'hamstrings,calves'),
    ('Skater Hop',                     'glutes,quads',                 'abductors,adductors,calves,cardio'),
    -- V49: bodyweight strength
    ('Air Squat',                      'quads,glutes',                 'hamstrings'),
    ('Lateral Lunge',                  'quads,adductors',              'glutes'),
    ('Incline Push-up',                'chest',                        'triceps,shoulders'),
    ('Diamond Push-up',                'triceps',                      'chest,shoulders'),
    ('Pike Push-up',                   'shoulders',                    'triceps,chest'),
    ('Inverted Row',                   'upper_back,lats',              'biceps,rear_delts'),
    ('Renegade Row',                   'lats,upper_back',              'abs,obliques,biceps'),
    ('Sit-up',                         'abs',                          'hip_flexors'),
    ('Crunch',                         'abs',                          ''),
    ('Reverse Crunch',                 'abs',                          'hip_flexors'),
    ('V-Up',                           'abs',                          'hip_flexors'),
    ('Lying Leg Raise',                'abs',                          'hip_flexors'),
    ('Hanging Knee Raise',             'abs',                          'hip_flexors,forearms'),
    ('Toes-to-Bar',                    'abs',                          'hip_flexors,lats,forearms'),
    ('Dead Bug',                       'abs',                          'hip_flexors'),
    ('Bird Dog',                       'lower_back',                   'abs,glutes'),
    ('Plank Shoulder Tap',             'abs',                          'obliques,shoulders'),
    ('Barbell Thruster',               'quads,glutes,shoulders',       'triceps,abs'),
    ('Dumbbell Thruster',              'quads,glutes,shoulders',       'triceps,abs'),
    ('Wall Ball',                      'quads,glutes,shoulders',       'triceps,cardio'),
    ('Turkish Get-up',                 'shoulders,abs',                'obliques,glutes,quads');

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
