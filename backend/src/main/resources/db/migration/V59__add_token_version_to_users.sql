-- Lets an issued JWT be invalidated before its 30-day expiry.
--
-- Tokens are stateless and were accepted purely on their signature and expiry, so there was no way
-- to end a session early. The consequence that matters: resetting your password did NOT sign out
-- anywhere else. Someone who resets precisely BECAUSE they think they are compromised stayed
-- compromised for up to thirty more days, while being shown a screen implying the opposite.
--
-- The token carries this number as a `tv` claim; JwtAuthenticationFilter refuses a token whose
-- claim no longer matches the row. Bumping it therefore invalidates every token issued before the
-- bump, everywhere, at once.
--
-- Defaults to 0 so every token already in circulation keeps working: those carry no `tv` claim at
-- all, and a missing claim reads as 0, which matches. Same backward-compatibility shape as the
-- `role` claim before it -- and, as with role, the default must never be inverted into something
-- that fails OPEN.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'token_version')
BEGIN
    ALTER TABLE users ADD token_version INT NOT NULL
        CONSTRAINT DF_users_token_version DEFAULT 0;
END
