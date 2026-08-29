-- One subscription row per account -- accounts is the billable entity (one household, one
-- login, many people), so there is no seat concept here and account_id is UNIQUE.
--
-- This table stores what Stripe told us, never what the app decided: `plan` and `status` are
-- written only by the reconcile path (a checkout-session read, a webhook, or the reconciliation
-- watchdog). Entitlement itself is DERIVED from status + current_period_end + comped in
-- SubscriptionService.isPro -- do not add an "is_pro" column and read it, or the four cases that
-- derivation gets right (past-due grace, cancelled-but-paid-through, clock-based expiry with no
-- webhook, comped) become four places to keep in sync.
--
-- `comped` grants Pro with no Stripe object behind it: it is how a handful of founding households
-- are kept whole when the Free-tier window lands, without distributing coupon codes, prompting for
-- a card, or adding a write action to a deliberately read-only admin portal.
--
-- ⚠️ billing_plan and billing_interval, NOT "plan"/"interval" -- both PLAN and INTERVAL are
-- reserved words in T-SQL, and an unbracketed reserved word fails the migration outright
-- ("Incorrect syntax near the keyword 'plan'"). Prefixing beats bracketing: [plan] would work in
-- DDL but leaves every future hand-written query one forgotten bracket away from the same error.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'subscriptions')
BEGIN
    CREATE TABLE subscriptions (
        id                     BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id             BIGINT NOT NULL,
        stripe_customer_id     NVARCHAR(255) NULL,
        stripe_subscription_id NVARCHAR(255) NULL,
        stripe_price_id        NVARCHAR(255) NULL,
        billing_plan           NVARCHAR(20) NOT NULL CONSTRAINT DF_subscriptions_billing_plan DEFAULT 'FREE',
        status                 NVARCHAR(30) NOT NULL CONSTRAINT DF_subscriptions_status DEFAULT 'FREE',
        billing_interval       NVARCHAR(10) NULL,
        current_period_end     DATETIME2 NULL,
        cancel_at_period_end   BIT NOT NULL CONSTRAINT DF_subscriptions_cancel_at_period_end DEFAULT 0,
        comped                 BIT NOT NULL CONSTRAINT DF_subscriptions_comped DEFAULT 0,
        created_at             DATETIME2 NOT NULL CONSTRAINT DF_subscriptions_created_at DEFAULT GETDATE(),
        updated_at             DATETIME2 NOT NULL CONSTRAINT DF_subscriptions_updated_at DEFAULT GETDATE()
    );
END

-- NO ACTION (the default), matching every other account-owned table here: deletion order is
-- AccountDeletionService's and TestDataCleanupService's job, and both have tests pinning it.
-- See V55's comment for why cascades are avoided across this schema.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_subscriptions_account')
BEGIN
    ALTER TABLE subscriptions ADD CONSTRAINT FK_subscriptions_account
        FOREIGN KEY (account_id) REFERENCES accounts(id);
END

-- One subscription per account, enforced by the database rather than by convention: two rows for
-- one household would make "what plan am I on" ambiguous at exactly the moment money is involved.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_subscriptions_account_id')
BEGIN
    CREATE UNIQUE INDEX UX_subscriptions_account_id ON subscriptions(account_id);
END

-- Filtered to non-null: every account has a row from the moment it is created, but only the ones
-- that have actually reached Stripe carry these ids. The uniqueness is what stops a second Stripe
-- Customer being silently attached to a household that already has one.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_subscriptions_stripe_customer_id')
BEGIN
    CREATE UNIQUE INDEX UX_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id)
        WHERE stripe_customer_id IS NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_subscriptions_stripe_subscription_id')
BEGIN
    CREATE UNIQUE INDEX UX_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id)
        WHERE stripe_subscription_id IS NOT NULL;
END

-- The reconciliation watchdog's query: find subscriptions whose paid period has lapsed but whose
-- status still claims otherwise, i.e. a subscription.deleted event that never arrived.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_subscriptions_current_period_end')
BEGIN
    CREATE INDEX IX_subscriptions_current_period_end ON subscriptions(current_period_end)
        WHERE current_period_end IS NOT NULL;
END

-- Backfill: every account that already exists is on Free. SubscriptionService treats a missing row
-- as Free anyway (a read must never fail because billing has no opinion yet), but backfilling keeps
-- "one row per account" true from here on rather than only for accounts created after this ran.
INSERT INTO subscriptions (account_id, billing_plan, status)
SELECT a.id, 'FREE', 'FREE'
FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.account_id = a.id);
