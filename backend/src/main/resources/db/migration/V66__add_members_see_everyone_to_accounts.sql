-- Whether a MEMBER login can see the rest of the household, or only themselves.
--
-- ⚠️ THIS COLUMN HAS NO ENDPOINT AND NO UI, AND THAT IS DELIBERATE. DO NOT "FINISH" IT.
--
-- For the Pro/Family plan the answer is always ON -- everyone in a household sees everyone, which
-- is what the app has always done and what families expect. Shipping it as a column with no way to
-- change it means Pro/Family is forced ON *by construction* rather than by a check somebody could
-- later flip, and there is no half-built setting sitting in the UI for a plan that does not use it.
--
-- It exists now, rather than later, because the alternative is worse: adding the concept after the
-- fact would mean retrofitting a permission through every read path a second time. The permission
-- (VIEW_OTHER_PEOPLE), the guards, and the read-only mode are all built and tested against BOTH
-- values in this same release -- see PersonGuardTest and member-permissions.spec.ts -- so the OFF
-- path is exercised code, not dead code waiting to rot.
--
-- The Team tier is what turns it on: a coach wants athletes to see only their own numbers. That is
-- when an endpoint and a toggle get built, on top of a column whose behaviour is already proven.
-- Until then the only thing that can set it to 0 is the profile-gated test-support endpoint.
--
-- DEFAULT 1 so every existing household keeps exactly the visibility it has today. A migration
-- that changed what people could see, as a side effect of shipping the ability to change it, would
-- be the worst possible introduction to the feature -- the same call V62 made for routine order.
IF NOT EXISTS (SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID('accounts') AND name = 'members_see_everyone')
BEGIN
    ALTER TABLE accounts ADD members_see_everyone BIT NOT NULL
        CONSTRAINT DF_accounts_members_see_everyone DEFAULT 1;
END
