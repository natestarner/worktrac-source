-- Foreign keys and indexes for V70's invites.
--
-- Split from V70 for the usual reason: SQL Server cannot reference a column added earlier in the
-- same un-batched script, which is why V40/V41, V42/V43, V47/V48, V54/V55 and V67/V68 are all
-- split pairs.
--
-- ⚠️ Every FK is NO ACTION (the default), and must stay that way. account_memberships (V63), the
-- import stamps (V55) and the creator stamps (V68) are all non-cascading for the same reason: SQL
-- Server refuses multiple cascade paths, and these rows are reachable from accounts by three
-- routes at once. The cost is that deletion order is app code's problem -- AccountDeletionService
-- and TestDataCleanupService must clear invites before the accounts, people and users they point
-- at, and both have tests pinning that.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_membership_invites_account')
BEGIN
    ALTER TABLE membership_invites ADD CONSTRAINT FK_membership_invites_account
        FOREIGN KEY (account_id) REFERENCES accounts(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_membership_invites_person')
BEGIN
    ALTER TABLE membership_invites ADD CONSTRAINT FK_membership_invites_person
        FOREIGN KEY (person_id) REFERENCES people(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_membership_invites_invited_by')
BEGIN
    ALTER TABLE membership_invites ADD CONSTRAINT FK_membership_invites_invited_by
        FOREIGN KEY (invited_by_user_id) REFERENCES users(id);
END

-- ⚠️ ONE OUTSTANDING INVITE PER PERSON, and FILTERED so accepted ones do not count.
--
-- Without the filter this would allow exactly one invite per person EVER, so a declined or expired
-- invitation could never be reissued. With it, "pending" is unique and history is unbounded.
--
-- The `WHERE` is not optional in T-SQL for a different reason too: a plain unique index treats
-- NULLs as EQUAL, so `accepted_at` being null on every pending row would collide on its own. Same
-- trap V63's (account_id, person_id) index documents.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_membership_invites_pending')
BEGIN
    CREATE UNIQUE INDEX UX_membership_invites_pending
        ON membership_invites(account_id, person_id)
        WHERE accepted_at IS NULL;
END

-- ⚠️ ACCEPT CANNOT LOOK A ROW UP BY THE TOKEN, and that shapes the invite link.
--
-- token_hash is a BCrypt digest with a per-row salt, so hashing the token a second time produces a
-- different string every time -- there is no equality to index. The link therefore carries an
-- invite ID alongside the secret (`/join?i=<id>&t=<token>`): the id finds exactly one row by
-- primary key, and passwordEncoder.matches() is what actually authorizes. Same shape as
-- pending_registrations, which looks up by EMAIL and then matches the typed code; only the lookup
-- key differs, because nobody types this one.
--
-- This index is for the other question -- "does this address already have something outstanding
-- here" -- which the owner's Logins list and the resend path both ask. Not unique: the same
-- address may legitimately be invited to two different households at once.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_membership_invites_email')
BEGIN
    CREATE INDEX IX_membership_invites_email ON membership_invites(email);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_membership_invites_account')
BEGIN
    CREATE INDEX IX_membership_invites_account ON membership_invites(account_id);
END
