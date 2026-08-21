-- Reuses the existing single-row admin alert settings rather than introducing a second toggle
-- mechanism for "which admin alerts do I actually want emailed" -- the portal already renders
-- these, so the contact toggle comes along for free.
--
-- Defaults to 1: a contact message is a deliberate, rate-limited, authenticated action by a real
-- household member, so unlike alert_on_registration_confirmed (which defaults off because it fires
-- on every signup) you want to hear about every one of these.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('registration_alert_settings') AND name = 'alert_on_contact_message'
)
BEGIN
    ALTER TABLE registration_alert_settings
        ADD alert_on_contact_message BIT NOT NULL CONSTRAINT DF_alert_settings_contact DEFAULT 1;
END
