-- Attribute every existing household-owned exercise and tag to that household's OWNER.
--
-- Like V64, this is a faithful restatement of the current state rather than a decision about it:
-- until member logins existed an account had exactly one login, so its owner is provably the only
-- person who could have created any of these rows. Nobody gains or loses anything.
--
-- Deliberately leaves NULL where there is no answer, rather than inventing one:
--   * GLOBAL exercises (account_id IS NULL) are preloaded catalog -- no household created them,
--     and they are already immutable to everyone;
--   * an account with no OWNER membership has nobody to attribute to.
-- Both fail closed -- see V67 -- so a NULL is safe, and a wrong guess would not be.
--
-- Idempotent twice over: the WHERE clause only touches unattributed rows, and TOP(1) with an
-- explicit ORDER BY makes the owner choice deterministic if an account ever holds more than one
-- OWNER membership (the schema permits it; the app does not create it). Same reasoning as V64's
-- primary-person subquery, for the same reason -- an unordered subquery returning two rows would
-- fail the entire migration.
UPDATE e
   SET created_by_user_id = (SELECT TOP(1) m.user_id
                               FROM account_memberships m
                              WHERE m.account_id = e.account_id
                                AND m.account_role = 'OWNER'
                              ORDER BY m.created_at ASC, m.id ASC)
  FROM exercises e
 WHERE e.account_id IS NOT NULL
   AND e.created_by_user_id IS NULL;

UPDATE t
   SET created_by_user_id = (SELECT TOP(1) m.user_id
                               FROM account_memberships m
                              WHERE m.account_id = t.account_id
                                AND m.account_role = 'OWNER'
                              ORDER BY m.created_at ASC, m.id ASC)
  FROM tags t
 WHERE t.created_by_user_id IS NULL;
