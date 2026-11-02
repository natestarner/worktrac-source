-- The transactional outbox (outbox.Outbox, outbox.OutboxDispatcher).
--
-- Every email -- and the Stripe cancellation that follows an account deletion -- used to live only
-- in memory between the commit that caused it and the moment it was sent: an @Async task in a
-- 200-slot in-process queue. A replica that scaled in, redeployed or crashed in that window took
-- it with it, with nothing anywhere to say it had been owed. With several replicas scaling in and
-- out, that window is routine.
--
-- Now the business transaction writes a row here, so the work commits or rolls back WITH the change
-- that caused it. The replica that committed tries it straight away; every replica also polls for
-- due rows, so a row whose replica died is picked up by another.
--
--   handler         which OutboxHandler delivers it ("email.verification-code", "stripe.cancel...")
--   payload         the handler's input as JSON, AES-GCM encrypted (it can hold a raw verification
--                   code or invite token). Set to NULL as soon as the row is SENT or FAILED.
--   status          PENDING -> SENT, or PENDING -> FAILED once attempts are exhausted. Nothing is
--                   ever deleted automatically except SENT rows past their retention.
--   attempts        incremented by the claim, so a crash mid-send still counts the attempt
--   next_attempt_at when the row is next due (backoff after a failure)
--   claimed_until   a replica's lease on the row while it sends; an expired lease is reclaimable,
--                   which is how a row survives the death of the replica sending it
--   cid             the request's correlation id, so the send's logs join that request's trail
--
-- All timestamps are the DATABASE's clock (SYSUTCDATETIME()), never a replica's.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'outbox')
BEGIN
    CREATE TABLE outbox (
        id              BIGINT IDENTITY(1,1) NOT NULL,
        handler         NVARCHAR(100)  NOT NULL,
        payload         NVARCHAR(MAX)  NULL,
        status          NVARCHAR(16)   NOT NULL CONSTRAINT DF_outbox_status DEFAULT 'PENDING',
        attempts        INT            NOT NULL CONSTRAINT DF_outbox_attempts DEFAULT 0,
        next_attempt_at DATETIME2      NOT NULL CONSTRAINT DF_outbox_next_attempt_at DEFAULT SYSUTCDATETIME(),
        claimed_until   DATETIME2      NULL,
        created_at      DATETIME2      NOT NULL CONSTRAINT DF_outbox_created_at DEFAULT SYSUTCDATETIME(),
        completed_at    DATETIME2      NULL,
        last_error      NVARCHAR(2000) NULL,
        cid             NVARCHAR(64)   NULL,
        CONSTRAINT PK_outbox PRIMARY KEY (id),
        CONSTRAINT CK_outbox_status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
    );
END

-- The poller's only query: due PENDING rows. Filtered, so it stays tiny however many SENT rows the
-- table is holding for retention.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_outbox_pending_due')
BEGIN
    CREATE INDEX IX_outbox_pending_due
        ON outbox(next_attempt_at)
        INCLUDE (claimed_until)
        WHERE status = 'PENDING';
END

-- The retention purge (SENT rows past 30 days).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_outbox_status_completed_at')
BEGIN
    CREATE INDEX IX_outbox_status_completed_at
        ON outbox(status, completed_at);
END
