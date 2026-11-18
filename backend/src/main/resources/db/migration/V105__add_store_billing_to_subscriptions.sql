-- In-App Purchase: an app store (Apple now, Google Play later) becomes a second writer of the SAME
-- subscriptions row Stripe writes. One row per household is unchanged; these columns only say WHO is
-- billing it and how to ask that store about it. See docs/in-app-purchase-plan.md and
-- .claude/rules/billing.md ("Who bills a household").
--
-- Every column is nullable and additive. A household that has never touched a store keeps NULL in
-- all of them, and every existing query is untouched.
--
-- ⚠️ THE `GO` SEPARATORS ARE LOAD-BEARING (see V77): SQL Server compiles a whole batch before running
-- any of it, so the backfill and the indexes below must not share a batch with the ALTERs that add
-- the columns they name.

-- Which source writes this row: STRIPE, APP_STORE or GOOGLE_PLAY. NULL means nothing has ever billed
-- it (or Stripe did before this column existed -- backfilled below).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('subscriptions') AND name = 'billing_source')
BEGIN
    ALTER TABLE subscriptions ADD billing_source NVARCHAR(20) NULL;
END

-- A random id created once per household and handed to the store with every purchase (Apple's
-- appAccountToken, Google's obfuscatedAccountId). The store signs it into the purchase, which is how
-- a store message is matched to a household WITHOUT trusting whoever is signed in on the phone.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('subscriptions') AND name = 'store_account_token')
BEGIN
    ALTER TABLE subscriptions ADD store_account_token UNIQUEIDENTIFIER NULL;
END

-- The store's id for the subscription (Apple: originalTransactionId, stable across renewals and plan
-- changes; Google: the purchase token, which can run to several hundred characters).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('subscriptions') AND name = 'store_subscription_id')
BEGIN
    ALTER TABLE subscriptions ADD store_subscription_id NVARCHAR(512) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('subscriptions') AND name = 'store_product_id')
BEGIN
    ALTER TABLE subscriptions ADD store_product_id NVARCHAR(100) NULL;
END

-- PRODUCTION or SANDBOX. App Review and TestFlight buy in the sandbox even against the production
-- backend, so both are accepted everywhere and this records which one a row came from.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('subscriptions') AND name = 'store_environment')
BEGIN
    ALTER TABLE subscriptions ADD store_environment NVARCHAR(20) NULL;
END

-- The one-purchase-at-a-time claim: set by POST /api/billing/store/{source}/prepare with a conditional
-- UPDATE, cleared when the purchase lands, is cancelled, or after ten minutes. Stops two devices on
-- two Apple IDs both buying for one household -- the overlap nobody but the buyer could undo.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('subscriptions') AND name = 'store_purchase_started_at')
BEGIN
    ALTER TABLE subscriptions ADD store_purchase_started_at DATETIME2 NULL;
END
GO

-- Everything Stripe has ever billed is Stripe's.
UPDATE subscriptions SET billing_source = 'STRIPE'
WHERE billing_source IS NULL AND stripe_subscription_id IS NOT NULL;
GO

-- Unique where set: one token names one household, or a store message could be applied to two.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_subscriptions_store_account_token')
BEGIN
    CREATE UNIQUE INDEX UX_subscriptions_store_account_token ON subscriptions(store_account_token)
        WHERE store_account_token IS NOT NULL;
END
GO

-- Not unique: the store's id is looked up first for every message, but a household that let one
-- store subscription lapse keeps its id on the row, and nothing should fail because of that.
-- NVARCHAR(512) is 1024 bytes, under SQL Server's 1700-byte nonclustered key limit.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_subscriptions_store_subscription_id')
BEGIN
    CREATE INDEX IX_subscriptions_store_subscription_id ON subscriptions(store_subscription_id)
        WHERE store_subscription_id IS NOT NULL;
END
GO
