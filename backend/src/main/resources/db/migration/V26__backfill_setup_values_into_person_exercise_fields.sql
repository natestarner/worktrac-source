-- Setup fields are becoming per-person only: the shared System-A tables
-- (exercise_setup_fields + setup_values) are being dropped in favor of the per-person
-- person_exercise_fields overlay. Move every entered value across first so no real data is
-- lost. Seeded base-field names a person never entered a value for are intentionally NOT
-- carried over.

-- 1) Ensure a person_exercise overlay row exists for each (person, exercise) that has a value.
INSERT INTO person_exercise (person_id, exercise_id, is_favorite, person_category_id)
SELECT DISTINCT sv.person_id, esf.exercise_id, 0, NULL
FROM setup_values sv
JOIN exercise_setup_fields esf ON esf.id = sv.exercise_setup_field_id
WHERE NOT EXISTS (
    SELECT 1 FROM person_exercise pe
    WHERE pe.person_id = sv.person_id AND pe.exercise_id = esf.exercise_id
);

-- 2) Copy each entered value into person_exercise_fields (field name from the shared field,
--    value from the person's setup_value, preserving sort order). Skip names the person
--    already has on that exercise, so re-running is a no-op.
INSERT INTO person_exercise_fields (person_exercise_id, name, value, sort_order)
SELECT pe.id, esf.name, sv.value, esf.sort_order
FROM setup_values sv
JOIN exercise_setup_fields esf ON esf.id = sv.exercise_setup_field_id
JOIN person_exercise pe ON pe.person_id = sv.person_id AND pe.exercise_id = esf.exercise_id
WHERE NOT EXISTS (
    SELECT 1 FROM person_exercise_fields pef
    WHERE pef.person_exercise_id = pe.id AND pef.name = esf.name
);
