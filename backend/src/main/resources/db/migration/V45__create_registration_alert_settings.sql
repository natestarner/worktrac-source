-- Single-row admin-configurable toggle set controlling which registration events trigger an
-- alert email to ADMIN_EMAILS. Deliberately a table (not env-var config) so an admin can flip
-- these from the portal without a redeploy. Seeded with exactly one row (id = 1) that the app
-- always reads/updates -- there is never a second row.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'registration_alert_settings')
BEGIN
    CREATE TABLE registration_alert_settings (
        id                                BIGINT NOT NULL PRIMARY KEY,
        alert_on_registration_confirmed  BIT NOT NULL DEFAULT 0,
        alert_on_send_failure            BIT NOT NULL DEFAULT 1,
        alert_on_delivery_failure        BIT NOT NULL DEFAULT 1,
        updated_at                       DATETIME2 NOT NULL DEFAULT GETDATE()
    );
END

IF NOT EXISTS (SELECT 1 FROM registration_alert_settings WHERE id = 1)
BEGIN
    INSERT INTO registration_alert_settings (id, alert_on_registration_confirmed, alert_on_send_failure, alert_on_delivery_failure)
    VALUES (1, 0, 1, 1);
END
