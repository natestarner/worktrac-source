-- Full observability trail for the registration lifecycle -- one row per meaningful event,
-- from the initial form submit through account creation, plus the async email send/delivery
-- outcome. Never stores the verification code or password -- email, event type, a sanitized
-- detail string (the "why": rate-limit reason, ACS error, or the recipient server's real
-- bounce/spam diagnostic), the request IP, and (for email send/delivery events) the ACS
-- messageId that correlates a send with its later Event Grid delivery report.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'registration_events')
BEGIN
    CREATE TABLE registration_events (
        id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        email       NVARCHAR(255) NOT NULL,
        event_type  NVARCHAR(40) NOT NULL,
        detail      NVARCHAR(1000) NULL,
        ip_address  NVARCHAR(45) NULL,
        message_id  NVARCHAR(100) NULL,
        created_at  DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_registration_events_created_at')
BEGIN
    CREATE INDEX IX_registration_events_created_at ON registration_events(created_at DESC);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_registration_events_email')
BEGIN
    CREATE INDEX IX_registration_events_email ON registration_events(email);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_registration_events_message_id')
BEGIN
    CREATE INDEX IX_registration_events_message_id ON registration_events(message_id);
END
