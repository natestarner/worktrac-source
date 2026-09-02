-- The record frontend/public/boot-watchdog.js writes when the app fails to start at all.
--
-- Separate from client_error rather than sharing it, because the two cannot substitute for each
-- other: client_error is written by a React error boundary, so it only exists when React was alive
-- enough to catch something. A boot that never rendered -- the shape every white-screen report so
-- far has taken (2026-08-25, 2026-08-31, 2026-09-02) -- produces nothing there at all. This column
-- is the only place that failure is ever recorded, for the same reason client_error is the only
-- place a render throw is: neither reaches Azure in any form.
--
-- Same NVARCHAR(2000) bound as client_error; the client caps its own payload well under it.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('contact_messages') AND name = 'boot_failure'
)
BEGIN
    ALTER TABLE contact_messages ADD boot_failure NVARCHAR(2000) NULL;
END
