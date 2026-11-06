-- The fixed muscle vocabulary an exercise is described with ("muscles worked"). Reference data,
-- not per-account: every household sees the same list, and nobody can add to it from the app.
--
-- This is deliberately NOT a return of the categories V33 dropped. Categories were a way for a
-- person to ORGANISE their own exercises, and that job now belongs to free-form tags, which stay.
-- A muscle is a fact about the movement, the same for everyone, so it is reference data like
-- tracking_type -- and it is what the body diagram and the Trends muscle heat map draw from.
--
-- code       stable identifier, the only thing the API and the client ever exchange
-- name       display name (the client carries its own copy; both equal shared/muscles/muscles.json)
-- sort_order the order muscles are listed in, roughly head to toe, front before back
-- drawn      1 = has a shape on the body diagram; 0 = listed in text only (adductors, neck, ...)
-- counted    1 = counts toward muscle-volume statistics; 0 = a display label, not a muscle
--            ("Full body", "Cardio" -- what conditioning work is described with)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'muscles')
BEGIN
    CREATE TABLE muscles (
        code        NVARCHAR(30) NOT NULL CONSTRAINT PK_muscles PRIMARY KEY,
        name        NVARCHAR(50) NOT NULL,
        sort_order  INT          NOT NULL,
        drawn       BIT          NOT NULL,
        counted     BIT          NOT NULL
    );
END
