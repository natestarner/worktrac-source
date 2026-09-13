-- Splits IDENTITY from MEMBERSHIP, which is what makes per-person logins possible.
--
-- Until now `users` carried account_id, so one email meant one household forever. That is a dead
-- end in two directions: a kid given a login here can never later pay for their own account with
-- the same address (V2's own comment anticipated this), and a parent who owns a household can
-- never also be a coach on a team account.
--
-- After this, `users` holds ONE globally-unique credential per human -- email, password,
-- token_version, lockout -- and a row here says "this credential may act inside this account, in
-- this role, as this person". One email, one password, one reset flow, N households.
--
-- account_role is NOT users.role. users.role is the PLATFORM flag (USER/ADMIN) sourced from
-- ADMIN_EMAILS and used only to gate /api/admin/**. The two are independent on purpose: a Huddle
-- admin is not thereby an owner of anyone's household, and a household owner is not thereby a
-- Huddle admin. Keeping them in separate columns on separate tables is what stops one being
-- "simplified" into the other later.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'account_memberships')
BEGIN
    CREATE TABLE account_memberships (
        id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id   BIGINT NOT NULL,
        user_id      BIGINT NOT NULL,
        -- Which Person this login IS. Nullable, and legitimately so: an owner need not correspond
        -- to a person at all, and a membership must survive its person being removed rather than
        -- silently deleting someone's way in.
        person_id    BIGINT NULL,
        account_role NVARCHAR(20) NOT NULL CONSTRAINT DF_account_memberships_role DEFAULT 'MEMBER',
        created_at   DATETIME2 NOT NULL CONSTRAINT DF_account_memberships_created_at DEFAULT GETDATE()
    );
END

-- Defaults to MEMBER rather than OWNER, deliberately. If a future insert path ever forgets to set
-- the role, the failure is "this person cannot do enough", which someone reports in a minute --
-- not "this person can do everything", which nobody notices. Same fail-closed reasoning as
-- JwtService's role claim defaulting to USER.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_account_memberships_role')
BEGIN
    ALTER TABLE account_memberships ADD CONSTRAINT CK_account_memberships_role
        CHECK (account_role IN ('OWNER', 'MEMBER'));
END

-- NO ACTION on all three, matching every other table in this schema. Three cascading paths into
-- accounts/users/people would be the multiple-cascade-path configuration SQL Server rejects
-- outright (see V55), and deletion order is AccountDeletionService's and TestDataCleanupService's
-- job, both of which have tests pinning it.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_account_memberships_account')
BEGIN
    ALTER TABLE account_memberships ADD CONSTRAINT FK_account_memberships_account
        FOREIGN KEY (account_id) REFERENCES accounts(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_account_memberships_user')
BEGIN
    ALTER TABLE account_memberships ADD CONSTRAINT FK_account_memberships_user
        FOREIGN KEY (user_id) REFERENCES users(id);
END

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_account_memberships_person')
BEGIN
    ALTER TABLE account_memberships ADD CONSTRAINT FK_account_memberships_person
        FOREIGN KEY (person_id) REFERENCES people(id);
END

-- One membership per (account, user): a login is in a household once, in one role. Without this,
-- "what may this person do here" could have two answers and AccountAccessService would have to
-- pick one.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_account_memberships_account_user')
BEGIN
    CREATE UNIQUE INDEX UX_account_memberships_account_user
        ON account_memberships(account_id, user_id);
END

-- One login per person. FILTERED to non-null because person_id is nullable and T-SQL treats NULLs
-- as EQUAL in a plain unique index -- so an unfiltered version would allow only a single
-- person-less membership per account, which is not the rule being expressed here.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_account_memberships_account_person')
BEGIN
    CREATE UNIQUE INDEX UX_account_memberships_account_person
        ON account_memberships(account_id, person_id) WHERE person_id IS NOT NULL;
END

-- The hot path: AccountAccessService resolves (user_id, account_id) on every authenticated
-- request, and login resolves every membership for one user. The (account_id, user_id) unique
-- index above cannot serve a user_id-leading lookup.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_account_memberships_user_id')
BEGIN
    CREATE INDEX IX_account_memberships_user_id ON account_memberships(user_id);
END
