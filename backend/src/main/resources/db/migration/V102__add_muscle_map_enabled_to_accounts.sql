-- Whether this account shows the muscle highlighter: the body drawings that shade the muscles an
-- exercise works (the Log screen's About strip and sheet, every exercise preview, and the Trends
-- "Muscles worked" card).
--
-- Account-wide, owner-set, OFF by default -- decided with Nate 2026-11-08. The drawings are
-- anatomical, like a gym's muscle chart; nothing about them changes the app's age rating, but a
-- household gets to decide whether it wants them on screen rather than finding them there. Off,
-- each of those places shows a short note linking to Settings instead.
--
-- DEFAULT 0 for EVERY row, existing households included. The highlighter had not reached
-- production when this shipped, so no one loses something they already had.
IF NOT EXISTS (SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID('accounts') AND name = 'muscle_map_enabled')
BEGIN
    ALTER TABLE accounts ADD muscle_map_enabled BIT NOT NULL
        CONSTRAINT DF_accounts_muscle_map_enabled DEFAULT 0;
END
