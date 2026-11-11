-- A login's Apple or Google identities: "this person may also sign in as users.id = X by proving
-- they are subject S at provider P". See docs/architecture/social-sign-in.md.
--
-- (provider, subject) is the identity, and it is UNIQUE: a returning person is found by the
-- provider's stable subject id, NEVER by email. People change their Google address, and an Apple
-- "Hide My Email" relay address can be turned off and replaced, but the subject is for life.
-- email_at_link is a record of what the provider said when the link was made, for the admin portal
-- and for support -- it is not a lookup key and nothing signs in by it.
--
-- ON DELETE CASCADE, unlike most FKs here, and deliberately: an identity is a pure child of its
-- credential, nothing references it, and it has no meaning once the user is gone. Every path that
-- removes a user (account deletion's member reap, test-data cleanup's bulk delete by email) then
-- removes its identities with it, including any path added later. NO ACTION would make each of
-- those paths fail the moment somebody had linked Google.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_identities')
BEGIN
    CREATE TABLE user_identities (
        id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id        BIGINT NOT NULL,
        provider       NVARCHAR(20) NOT NULL,
        subject        NVARCHAR(255) NOT NULL,
        email_at_link  NVARCHAR(255) NULL,
        created_at     DATETIME2 NOT NULL CONSTRAINT DF_user_identities_created_at DEFAULT GETDATE(),
        last_used_at   DATETIME2 NULL,
        CONSTRAINT FK_user_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT CK_user_identities_provider CHECK (provider IN ('APPLE', 'GOOGLE', 'TEST'))
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_user_identities_provider_subject')
BEGIN
    CREATE UNIQUE INDEX UX_user_identities_provider_subject ON user_identities(provider, subject);
END

-- One identity per provider per login: "connect Google" a second time with a different Google
-- account must be an explicit unlink first, so a login never quietly gains a second way in.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_user_identities_user_provider')
BEGIN
    CREATE UNIQUE INDEX UX_user_identities_user_provider ON user_identities(user_id, provider);
END
