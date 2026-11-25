-- How weight applies to a set of an exercise: a second axis beside tracking_type (which answers
-- "what do you count": reps or seconds, one day distance). Kept separate so a future value on
-- either axis is one constant and one CHECK, not a rework of the other.
--
--   'external'   -- a weight is expected every set (barbell, dumbbell, machine, weighted dips)
--   'bodyweight' -- usually just you; the number logged is weight ADDED on top (a vest, a belt)
--
-- It changes only how the Log screen asks for a person's FIRST set of an exercise ("Enter a
-- weight" vs. 0 under "Added weight") and what the weight box is called. Records, volume and every
-- stat keep reading each set's own weight, never this column. Library rows are classified in V108.
--
-- NOT NULL with a default, added WITH VALUES, so every existing row (library and household) reads
-- 'external' -- the safe answer: an empty box plus "No weight, just bodyweight" on a first set.
-- Unlike tracking_type it may change after sets exist (PUT /api/exercises/{id}/load-type), since
-- it reinterprets nothing already logged.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('exercises') AND name = 'load_type'
)
BEGIN
    ALTER TABLE exercises
        ADD load_type NVARCHAR(20) NOT NULL
            CONSTRAINT DF_exercises_load_type DEFAULT 'external' WITH VALUES;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exercises_load_type')
BEGIN
    ALTER TABLE exercises WITH CHECK ADD CONSTRAINT CK_exercises_load_type
        CHECK (load_type IN ('external', 'bodyweight'));
END;
