-- Migrate existing per-person categories into the new shared-vocabulary tag model.
-- 1) Create account-level tags from the distinct category names each account's people used
--    (collapsing per-person category names into one shared vocabulary per account).
INSERT INTO tags (account_id, name)
SELECT DISTINCT p.account_id, pc.name
FROM person_categories pc
JOIN people p ON p.id = pc.person_id
WHERE NOT EXISTS (
    SELECT 1 FROM tags t WHERE t.account_id = p.account_id AND t.name = pc.name
);

-- 2) Link each person_exercise that was filed under a category to the matching account tag,
--    preserving who-tagged-what per person.
INSERT INTO person_exercise_tags (person_exercise_id, tag_id)
SELECT pe.id, t.id
FROM person_exercise pe
JOIN person_categories pc ON pc.id = pe.person_category_id
JOIN people p ON p.id = pe.person_id
JOIN tags t ON t.account_id = p.account_id AND t.name = pc.name
WHERE pe.person_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM person_exercise_tags pet
    WHERE pet.person_exercise_id = pe.id AND pet.tag_id = t.id
  );
