-- The muscle vocabulary (see V90). The sixteen drawn groups are exactly the regions the body
-- diagram can shade; the rest are real muscles with no shape of their own on it (still listed, and
-- still counted), plus two labels for conditioning work that no single muscle describes.
--
-- Idempotent like every seed here: re-running inserts nothing that already exists. Adding a muscle
-- later is a new migration, and shared/muscles/muscles.json and the client's list
-- (utils/muscles.js) must gain it in the same change -- LibraryExerciseMusclesTest and
-- muscles.test.js fail until all three agree.
INSERT INTO muscles (code, name, sort_order, drawn, counted)
SELECT x.code, x.name, x.sort_order, x.drawn, x.counted
FROM (VALUES
    ('neck',        'Neck',        10,  0, 1),
    ('traps',       'Traps',       20,  1, 1),
    ('shoulders',   'Shoulders',   30,  1, 1),
    ('rear_delts',  'Rear delts',  40,  1, 1),
    ('chest',       'Chest',       50,  1, 1),
    ('biceps',      'Biceps',      60,  1, 1),
    ('triceps',     'Triceps',     70,  1, 1),
    ('forearms',    'Forearms',    80,  1, 1),
    ('upper_back',  'Upper back',  90,  1, 1),
    ('lats',        'Lats',        100, 1, 1),
    ('lower_back',  'Lower back',  110, 1, 1),
    ('abs',         'Abs',         120, 1, 1),
    ('obliques',    'Obliques',    130, 1, 1),
    ('hip_flexors', 'Hip flexors', 140, 0, 1),
    ('glutes',      'Glutes',      150, 1, 1),
    ('abductors',   'Abductors',   160, 0, 1),
    ('adductors',   'Adductors',   170, 0, 1),
    ('quads',       'Quads',       180, 1, 1),
    ('hamstrings',  'Hamstrings',  190, 1, 1),
    ('calves',      'Calves',      200, 1, 1),
    ('full_body',   'Full body',   900, 0, 0),
    ('cardio',      'Cardio',      910, 0, 0)
) AS x(code, name, sort_order, drawn, counted)
WHERE NOT EXISTS (SELECT 1 FROM muscles m WHERE m.code = x.code);
