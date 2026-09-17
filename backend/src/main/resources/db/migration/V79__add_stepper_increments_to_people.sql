-- How much the Log screen's +/- buttons move the weight and the hold duration, per person. A
-- per-person preference for the same reason the rest timer is one (V39): a household member
-- training at 2.5 lb jumps and one training at 10 lb are both right, and Settings shows every
-- person's choice at once so the household is configured from one screen.
--
-- weight_increment is unit-agnostic on purpose -- it is a step size, not a weight, so it applies
-- whatever unit the set is being logged in. 2.5 is the smallest jump a standard plate pair makes
-- and is now the default for lb and kg alike; before this it was 5 for lb and 2.5 for kg, and
-- collapsing the two removes the unit branch from the client entirely.
--
-- duration_increment_seconds keeps the prior hardcoded 5: 1s takes forever to reach a minute and
-- 15s overshoots the short holds this is mostly used for.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('people') AND name = 'weight_increment')
BEGIN
    ALTER TABLE people ADD weight_increment DECIMAL(5,2) NOT NULL CONSTRAINT DF_people_weight_increment DEFAULT 2.5;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('people') AND name = 'duration_increment_seconds')
BEGIN
    ALTER TABLE people ADD duration_increment_seconds INT NOT NULL CONSTRAINT DF_people_duration_increment_seconds DEFAULT 5;
END
