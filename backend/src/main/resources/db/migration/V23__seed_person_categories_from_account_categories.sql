-- One-time courtesy backfill so existing households don't lose the categories they created
-- when categories become per-person. For every person, copy their account's own (non-global)
-- category NAMES into their personal category list. Global category names are deliberately
-- NOT copied -- those remain the recommendation palette everyone can adopt from on demand.
-- Idempotent via NOT EXISTS on the (person_id, name) uniqueness.
INSERT INTO person_categories (person_id, name, sort_order)
SELECT p.id, c.name, 0
FROM people p
JOIN categories c ON c.account_id = p.account_id
WHERE c.account_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM person_categories pc
      WHERE pc.person_id = p.id AND pc.name = c.name
  );
