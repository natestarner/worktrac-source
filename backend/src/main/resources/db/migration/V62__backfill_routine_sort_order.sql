-- Seeds routines.sort_order (added in V61) and makes it mandatory.
--
-- The backfill deliberately reproduces the ORDER THIS REPLACES -- created_at ascending, with id
-- as the tiebreak for rows sharing a timestamp -- so every existing household sees exactly the
-- order it saw before, and nothing moves until someone chooses to move it. A migration that
-- reordered people's routines as a side effect of shipping reordering would be the worst
-- possible introduction to the feature.
--
-- Zero-based to match RoutineService's assignment for new routines and routine_exercises'
-- existing sort_order convention (V11).
--
-- Guarded on the column still being nullable rather than on "has no values": that makes a re-run
-- a no-op instead of renumbering routines somebody has since dragged into their own order.
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('routines') AND name = 'sort_order' AND is_nullable = 1)
BEGIN
    WITH ordered AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY created_at, id) - 1 AS position
        FROM routines
    )
    UPDATE r
    SET r.sort_order = ordered.position
    FROM routines r
    INNER JOIN ordered ON ordered.id = r.id;

    ALTER TABLE routines ALTER COLUMN sort_order INT NOT NULL;
END
