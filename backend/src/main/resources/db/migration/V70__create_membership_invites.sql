-- An outstanding invitation for one person in one household to get their own login.
--
-- Deliberately shaped like pending_registrations (V18), because it is the same kind of thing: a
-- half-finished identity operation, proved by a hashed secret sent to an email address, with an
-- expiry, an attempt ceiling and a resend cooldown. Anything that needs explaining here is
-- explained there too.
--
-- ⚠️ THE TOKEN IS STORED AS A BCRYPT HASH, NEVER IN THE CLEAR. It is a bearer credential: whoever
-- holds it can attach a login to this household. A readable copy in the database is the same
-- mistake as storing a password, and this table is reachable by every backup, export and support
-- query the account table is.
--
-- ⚠️ NO `user_id` COLUMN, ON PURPOSE. An invite names an EMAIL, not a user, and it must behave
-- identically whether or not that address already has a Huddle account -- see
-- MembershipInviteService for why an instant-active outcome for an existing user would be a
-- user-enumeration oracle. Resolving the email to a user happens at ACCEPT time, once, and is not
-- recorded here in the meantime.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'membership_invites')
BEGIN
    CREATE TABLE membership_invites (
        id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id     BIGINT NOT NULL,
        person_id      BIGINT NOT NULL,
        email          NVARCHAR(255) NOT NULL,
        token_hash     NVARCHAR(255) NOT NULL,
        expires_at     DATETIME2 NOT NULL,
        attempt_count  INT NOT NULL DEFAULT 0,
        last_sent_at   DATETIME2 NOT NULL DEFAULT GETDATE(),
        resend_count   INT NOT NULL DEFAULT 0,
        -- NULL until accepted. Kept rather than deleted so "invite accepted" stays answerable --
        -- the owner's notification and the audit trail both need it after the fact.
        accepted_at    DATETIME2 NULL,
        -- Who sent it. NO ACTION like every other FK to users here, so deleting a login means
        -- clearing these first -- see V68's comment for the deletion-order cost this carries.
        invited_by_user_id BIGINT NULL,
        created_at     DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END
