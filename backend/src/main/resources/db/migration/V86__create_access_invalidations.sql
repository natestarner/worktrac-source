-- The cross-replica half of AccountAccessService's cache invalidation (AccessInvalidationLog).
--
-- The backend runs as several replicas, each with its own 60s in-memory cache of "what may this
-- login do in this household". An invalidation used to clear only the cache of the replica that
-- made it, so every other replica kept answering the old value for up to a minute -- a re-subscribed
-- household stayed paused, a revoked login kept working, a Pro owner hiding clients from each other
-- still exposed them. Every invalidation now also writes a row here, and every replica replays the
-- recent rows every couple of seconds.
--
-- One row per invalidation, at one of three scopes:
--   user_id + account_id -- one membership (invite accepted, login revoked, role changed)
--   user_id only         -- every household this login belongs to (password change or reset)
--   account_id only      -- every login in this household (plan change, visibility setting)
--
-- No foreign keys, deliberately: a row may outlive the user or account it names (account deletion
-- invalidates on its way out), and the row only ever drives cache evictions, which are harmless for
-- ids that no longer exist. Rows older than an hour are purged (AccessInvalidationPoller).
--
-- created_at is the DATABASE's clock, and so is the replay window it is compared against, so replica
-- clock skew plays no part.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'access_invalidations')
BEGIN
    CREATE TABLE access_invalidations (
        id         BIGINT IDENTITY(1,1) NOT NULL,
        user_id    BIGINT    NULL,
        account_id BIGINT    NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_access_invalidations_created_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_access_invalidations PRIMARY KEY (id),
        CONSTRAINT CK_access_invalidations_scope CHECK (user_id IS NOT NULL OR account_id IS NOT NULL)
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_access_invalidations_created_at')
BEGIN
    CREATE INDEX IX_access_invalidations_created_at
        ON access_invalidations(created_at)
        INCLUDE (user_id, account_id);
END
