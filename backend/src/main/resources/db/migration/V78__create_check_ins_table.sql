-- Check-ins: a dated entry about a PERSON, rather than about a set or an exercise.
--
-- ⚠️ ONE TABLE FOR TWO USES, deliberately. A trainer's private observation and a client's own
-- weigh-in are the same grain -- somebody, on a date, recording something about a person -- so they
-- share a table, a timeline read and a component. The alternative considered and rejected was a
-- `trainer_notes` table beside a `check_ins` table, which would have been a THIRD and FOURTH note
-- concept in a codebase that already has two (see below), each with its own query, its own DTO and
-- its own chance to leak into the wrong one.
--
-- The two uses are distinguished by exactly one column:
--   visible_to_person = 0  a manager's private observation. Staff only.
--   visible_to_person = 1  a check-in the person can see, including every one they wrote themselves.
--
-- ⚠️ THE THIRD NOTE CONCEPT, AND THE NAMING IS THE RISK. Two already exist and the person CAN see
-- both:
--   person_exercise.note      (V35) -- the "standing note" on one exercise, e.g. "seat height 4"
--   session_exercise_notes    (V36) -- the "note for this session", one workout only
-- Neither is about a PERSON and neither is ever private. The UI must keep these mutually
-- non-containing: the surface here is called "Check-ins" and deliberately never uses the word
-- "note" as a label, because Playwright matches accessible names as a case-insensitive substring
-- and "Notes" already exists on the same screens. See .claude/rules/coaching.md.

CREATE TABLE check_ins
(
    id                BIGINT IDENTITY (1,1) PRIMARY KEY,

    -- Whose check-in it is. CASCADE because a check-in is training data about that person and has
    -- no meaning without them -- the same relationship sets and sessions have.
    person_id         BIGINT        NOT NULL,

    -- Who wrote it. NULL is legitimate and must render as naming nobody: ON DELETE SET NULL, so a
    -- revoked or deleted login leaves the entry itself intact. Losing a client's weigh-in history
    -- because a trainer's assistant left would be the wrong trade -- same reasoning as
    -- routines.assigned_by_user_id and exercises.created_by_user_id.
    author_user_id    BIGINT        NULL,

    -- The date the check-in is ABOUT, which is not always when it was typed: a trainer catching up
    -- on Sunday still records Friday's session. created_at keeps the audit trail separately.
    entered_at        DATETIME2     NOT NULL,

    -- ⚠️ The unit is stamped beside the weight, exactly as workout_sets and routine_exercises do,
    -- and for the same reason: it must never be recomputed when the account's default unit changes.
    -- A weigh-in of 80 in kg does not become 80 lb because somebody flipped a setting.
    body_weight       DECIMAL(6, 2) NULL,
    body_weight_unit  NVARCHAR(2)   NULL,

    note              NVARCHAR(2000) NULL,

    -- Defaults to visible. A client writing their own check-in cannot hide it from themselves, and
    -- defaulting to private would mean a trainer's ordinary encouragement silently never reached
    -- the person it was for.
    visible_to_person BIT           NOT NULL CONSTRAINT DF_check_ins_visible DEFAULT 1,

    created_at        DATETIME2     NOT NULL CONSTRAINT DF_check_ins_created DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_check_ins_person FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE,
    CONSTRAINT FK_check_ins_author FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE SET NULL,

    -- A weight with no unit is uninterpretable; a unit with no weight is noise.
    CONSTRAINT CK_check_ins_weight_unit
        CHECK ((body_weight IS NULL AND body_weight_unit IS NULL)
            OR (body_weight IS NOT NULL AND body_weight_unit IN ('lb', 'kg'))),

    -- An entry with neither a weight nor a note records nothing. Refused here rather than in the
    -- service because an empty row is the kind of thing a retry or a double-tap produces, and it
    -- would sit in a client's timeline as a dated blank.
    CONSTRAINT CK_check_ins_has_content
        CHECK (body_weight IS NOT NULL OR note IS NOT NULL)
);
GO

-- The only shape either surface reads: one person's timeline, newest first. entered_at rather than
-- created_at, because that is the order a person expects to see their own history in.
CREATE INDEX IX_check_ins_person_entered
    ON check_ins (person_id, entered_at DESC);
