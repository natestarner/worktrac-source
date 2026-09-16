-- Programs: a trainer's routine, copied onto a client, with the numbers they are meant to hit.
--
-- ⚠️ EVERY COLUMN HERE IS NULLABLE AND ADDITIVE, and that is the whole design. A routine stays a
-- routine: `person_id` is still NOT NULL, nothing is moved to a join table, and every existing
-- query against `routines` and `routine_exercises` is untouched. An assigned program is an ordinary
-- routine that happens to know who put it there.
--
-- The alternative -- a `programs` table beside `routines` -- would have meant two things that are
-- the same thing, two builders, two Log-screen readers, and a client whose "routines" list showed
-- only half of what they follow. See .claude/rules/coaching.md.

-- ⚠️ THE `GO` SEPARATORS ARE LOAD-BEARING, NOT STYLE. SQL Server compiles an entire batch before
-- executing any of it, so a constraint or index that names a column ADDed earlier in the same batch
-- fails to compile with "Invalid column name" -- even though the ALTER would have run first. Every
-- statement here that references a newly added column therefore needs its own batch. Flyway splits
-- SQL Server scripts on GO. Removing one of these breaks the migration outright, on every
-- environment, at deploy time.

-- Who assigned this routine, and when. Both NULL for every routine anybody has ever made for
-- themselves, which is the overwhelming majority and stays the default shape.
--
-- ⚠️ `assigned_by_user_id` is the USER (the credential), not the person. A trainer's own person row
-- can be renamed or removed while the credential persists, and the question this answers is "who
-- put this here", which is about the login that acted. Same axis as exercises.created_by_user_id.
--
-- ON DELETE SET NULL, deliberately: if that login is ever removed, the client keeps the program
-- they are following and it simply stops naming who assigned it. Cascading would delete somebody
-- else's training plan as a side effect of tidying up a login.
ALTER TABLE routines ADD assigned_by_user_id BIGINT NULL;
ALTER TABLE routines ADD assigned_at DATETIME2 NULL;
GO

ALTER TABLE routines
    ADD CONSTRAINT FK_routines_assigned_by FOREIGN KEY (assigned_by_user_id)
        REFERENCES users (id) ON DELETE SET NULL;
GO

-- The roster and the client's Log screen both ask "is this assigned?", so the filtered index covers
-- the only shape either one queries. Filtered because the column is NULL for almost every row.
CREATE INDEX IX_routines_assigned_by
    ON routines (assigned_by_user_id)
    WHERE assigned_by_user_id IS NOT NULL;
GO

-- What the trainer wants hit. NULL means "no target", which is every routine exercise that exists
-- today and every one a person builds for themselves.
--
-- ⚠️ The unit is stamped alongside the weight, exactly as workout_sets does, and for the same
-- reason: it must never be recomputed when the account's default unit changes later. A target of
-- 100 entered in kg does not become 100 lb because somebody flipped a setting.
--
-- DECIMAL(6,2) matches workout_sets.weight so a target and an actual are directly comparable
-- without a conversion that could round differently in the two places.
ALTER TABLE routine_exercises ADD target_weight DECIMAL(6,2) NULL;
ALTER TABLE routine_exercises ADD target_reps INT NULL;
ALTER TABLE routine_exercises ADD target_unit NVARCHAR(2) NULL;
GO

-- A target weight with no unit is not interpretable, and a unit with no weight is noise. Enforced
-- here rather than in the service because it is the kind of pair that drifts apart under a partial
-- update -- and a half-written target renders as a number with no idea what it means.
ALTER TABLE routine_exercises
    ADD CONSTRAINT CK_routine_exercises_target_unit
        CHECK ((target_weight IS NULL AND target_unit IS NULL)
            OR (target_weight IS NOT NULL AND target_unit IN ('lb', 'kg')));
GO

-- Reps are bounded the same way the logging path bounds them: a target of zero reps is not a
-- target, and a negative one is a typo that would render on a client's Log screen.
ALTER TABLE routine_exercises
    ADD CONSTRAINT CK_routine_exercises_target_reps
        CHECK (target_reps IS NULL OR target_reps > 0);
