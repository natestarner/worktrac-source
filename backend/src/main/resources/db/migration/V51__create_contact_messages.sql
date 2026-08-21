-- Suggestions and bug reports submitted from the in-app Contact Us page. The row is the source
-- of truth and commits synchronously on the request thread; the admin alert email is dispatched
-- afterwards, asynchronously, and can fail without ever losing the message. That ordering is the
-- direct lesson of docs/incidents/2026-08-01-email-blind-spots-and-delete-timeout.md, where the
-- only registration record that survived an email blackhole was the one already committed inside
-- the request's own transaction.
--
-- alert_status starts at PENDING rather than being nullable so "the async listener never ran at
-- all" is distinguishable from "it ran and succeeded" -- registration-and-email.md's rule that an
-- async dispatch mechanism must never have a code path where those two look the same from outside.
--
-- correlation_id is the join key into Log Analytics: the same per-install id the browser sends on
-- every request and the backend puts in its MDC, so a submission can be traced to that person's
-- actual request trail instead of guessing from a timestamp. client_error is the last render-time
-- error the app's ErrorBoundary caught -- those never reach Azure at all, so for a bug report it is
-- frequently the only record that the failure happened.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'contact_messages')
BEGIN
    CREATE TABLE contact_messages (
        id               BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id       BIGINT NOT NULL,
        user_id          BIGINT NOT NULL,
        person_id        BIGINT NULL,
        submitter_email  NVARCHAR(255) NOT NULL,
        category         NVARCHAR(20) NOT NULL,
        subject          NVARCHAR(150) NOT NULL,
        message          NVARCHAR(4000) NOT NULL,
        app_build        NVARCHAR(40) NULL,
        screen           NVARCHAR(80) NULL,
        user_agent       NVARCHAR(255) NULL,
        was_online       BIT NULL,
        unsynced_writes  INT NULL,
        correlation_id   NVARCHAR(64) NULL,
        client_error     NVARCHAR(2000) NULL,
        ip_address       NVARCHAR(45) NULL,
        alert_status     NVARCHAR(16) NOT NULL DEFAULT 'PENDING',
        alert_message_id NVARCHAR(100) NULL,
        alert_detail     NVARCHAR(1000) NULL,
        alert_updated_at DATETIME2 NULL,
        created_at       DATETIME2 NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_contact_messages_account FOREIGN KEY (account_id) REFERENCES accounts(id),
        CONSTRAINT FK_contact_messages_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT FK_contact_messages_person FOREIGN KEY (person_id) REFERENCES people(id),
        CONSTRAINT CK_contact_messages_category CHECK (category IN ('SUGGESTION', 'BUG', 'OTHER')),
        CONSTRAINT CK_contact_messages_alert_status CHECK (alert_status IN ('PENDING', 'SENT', 'FAILED'))
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_contact_messages_created_at')
BEGIN
    CREATE INDEX IX_contact_messages_created_at ON contact_messages(created_at DESC);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_contact_messages_account_id')
BEGIN
    CREATE INDEX IX_contact_messages_account_id ON contact_messages(account_id);
END

-- Backs the duplicate-suppression lookup, which filters by user and a recent created_at window.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_contact_messages_user_id_created_at')
BEGIN
    CREATE INDEX IX_contact_messages_user_id_created_at ON contact_messages(user_id, created_at DESC);
END
