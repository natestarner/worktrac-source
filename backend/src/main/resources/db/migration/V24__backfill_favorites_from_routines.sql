-- Back-compat: an exercise that a person has in a routine must keep showing in their Log
-- picker under the new favorites model. Logged exercises are covered automatically by the
-- picker's "favorites UNION has-a-logged-set" query, but routine-only exercises are not, so
-- seed a favorite for every existing (routine's person, routine exercise) pair. Going
-- forward RoutineService does this automatically on routine save. Idempotent via NOT EXISTS.
INSERT INTO person_exercise (person_id, exercise_id, is_favorite)
SELECT DISTINCT r.person_id, re.exercise_id, 1
FROM routine_exercises re
JOIN routines r ON r.id = re.routine_id
WHERE NOT EXISTS (
    SELECT 1 FROM person_exercise pe
    WHERE pe.person_id = r.person_id AND pe.exercise_id = re.exercise_id
);
