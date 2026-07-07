-- Renames a handful of V7-seeded system exercises to be explicit about equipment (so
-- e.g. a future barbell/dumbbell variant of the same movement doesn't read ambiguously),
-- and adds "Dumbbell Bench Press" as a new system exercise alongside "Barbell Bench
-- Press". account_id IS NULL scopes every UPDATE to the shared system row only -- a
-- household that has already forked one of these (see V15) keeps its own private copy
-- and its own name, untouched.
UPDATE exercises SET name = 'Barbell Back Squat' WHERE name = 'Back Squat' AND account_id IS NULL;
UPDATE exercises SET name = 'Barbell Bench Press' WHERE name = 'Bench Press' AND account_id IS NULL;
UPDATE exercises SET name = 'Dumbbell Bicep Curl' WHERE name = 'Bicep Curl' AND account_id IS NULL;
UPDATE exercises SET name = 'Dumbbell Overhead Press' WHERE name = 'Overhead Press' AND account_id IS NULL;

INSERT INTO exercises (account_id, category_id, name)
SELECT NULL, c.id, x.name
FROM (VALUES
    ('Dumbbell Bench Press', 'Upper Push')
) AS x(name, category_name)
JOIN categories c ON c.name = x.category_name AND c.account_id IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM exercises e WHERE e.name = x.name AND e.account_id IS NULL
);
