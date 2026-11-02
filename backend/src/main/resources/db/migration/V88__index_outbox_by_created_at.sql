-- Backs the global email caps (ratelimit.GlobalEmailCap), which count the user-facing emails queued
-- in the last hour straight from the outbox: "how many outbox rows for an email.* handler were
-- created since an hour ago". Counted from the table rather than an in-memory bucket so the cap is
-- one number across every replica, not one per replica.
--
-- created_at leads so the hour is a range seek; handler is carried so the filter on it needs no key
-- lookup. The count runs only on the two unauthenticated email endpoints (register/resend and
-- forgot/resend-reset), never on an ordinary request.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_outbox_created_at')
BEGIN
    CREATE INDEX IX_outbox_created_at
        ON outbox(created_at)
        INCLUDE (handler);
END
