-- Marks the moment a household's welcome-to-Pro email was sent, so it is sent exactly once ever
-- rather than on every renewal or every redelivered webhook. NULL means "not sent yet" -- true for
-- every existing row, so shipping this does not retroactively email anyone already on Pro.
--
-- Guarded in SubscriptionService.applyStripeState: a household only qualifies the moment it was
-- FALSE before this apply and true after, and only while this column is still NULL. See
-- .claude/rules/billing.md.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('subscriptions') AND name = 'pro_welcome_sent_at'
)
BEGIN
    ALTER TABLE subscriptions ADD pro_welcome_sent_at DATETIME2 NULL;
END
