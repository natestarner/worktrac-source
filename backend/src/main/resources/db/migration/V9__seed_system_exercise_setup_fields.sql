-- Setup field names for the system exercises seeded in V7 that need machine/rack
-- settings recorded, matching the design prototype's seed data.
INSERT INTO exercise_setup_fields (exercise_id, name, sort_order)
SELECT e.id, x.field_name, x.sort_order
FROM (VALUES
    ('Bench Press',      'Bar catch pin',        0),
    ('Bench Press',      'Spotter arm pin',       1),
    ('Incline DB Press',  'Bench incline pin',    0),
    ('Lat Pulldown',      'Seat pad height',      0),
    ('Lat Pulldown',      'Thigh pad position',   1),
    ('Back Squat',        'Safety pin height',    0),
    ('Back Squat',        'Bar hook height',      1),
    ('Leg Press',         'Seat position',        0)
) AS x(exercise_name, field_name, sort_order)
JOIN exercises e ON e.name = x.exercise_name AND e.account_id IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM exercise_setup_fields f
    WHERE f.exercise_id = e.id AND f.name = x.field_name
);
