-- Starter exercise library shared by every household, matching the design prototype's
-- seed data. account_id stays NULL (system exercise); category looked up by name since
-- V5 seeded categories before this migration runs.
INSERT INTO exercises (account_id, category_id, name)
SELECT NULL, c.id, x.name
FROM (VALUES
    ('Bench Press',        'Upper Push'),
    ('Overhead Press',     'Upper Push'),
    ('Incline DB Press',   'Upper Push'),
    ('Tricep Pushdown',    'Upper Push'),
    ('Barbell Row',        'Upper Pull'),
    ('Pull-up',            'Upper Pull'),
    ('Lat Pulldown',       'Upper Pull'),
    ('Bicep Curl',         'Upper Pull'),
    ('Back Squat',         'Lower Push'),
    ('Leg Press',          'Lower Push'),
    ('Walking Lunge',      'Lower Push'),
    ('Deadlift',           'Lower Pull'),
    ('Plank (sec)',        'Core'),
    ('Hanging Leg Raise',  'Core')
) AS x(name, category_name)
JOIN categories c ON c.name = x.category_name AND c.account_id IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM exercises e WHERE e.name = x.name AND e.account_id IS NULL
);
