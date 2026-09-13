-- One OWNER membership per existing user, bound to that account's primary person.
--
-- Every user that exists today IS their account's owner -- that was the only kind of login the app
-- could create -- so this is a faithful restatement of the current state, not a decision about it.
-- Nobody's access changes.
--
-- Idempotent via NOT EXISTS, matching V56's subscription backfill: Flyway will not re-run an
-- applied migration, but a backfill that is safe to run twice is safe to reason about when a
-- restore or a hand-repaired schema history puts it back in play.
INSERT INTO account_memberships (account_id, user_id, person_id, account_role)
SELECT u.account_id,
       u.id,
       -- The primary person, or NULL if the account somehow has none. TOP(1) with an explicit
       -- ORDER BY rather than a bare subquery: people.is_primary is not unique in the schema, and
       -- an unordered subquery returning two rows would fail the whole migration. Oldest wins,
       -- with id as a deterministic tiebreak, so re-running picks the same row.
       (SELECT TOP(1) p.id
          FROM people p
         WHERE p.account_id = u.account_id
           AND p.is_primary = 1
         ORDER BY p.created_at ASC, p.id ASC),
       'OWNER'
FROM users u
WHERE u.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1
                    FROM account_memberships m
                   WHERE m.account_id = u.account_id
                     AND m.user_id = u.id);
