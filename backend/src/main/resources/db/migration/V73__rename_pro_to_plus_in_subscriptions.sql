-- The paid tier is being renamed from "Pro" to "Plus" (making room for two future tiers, Team and
-- Pro, aimed at sports teams and personal trainers respectively -- see .claude/rules/billing.md).
-- V56 and V72 are NOT touched: they already ran, and a migration that has been applied is never
-- edited, only superseded. This migration carries the column/value rename those two established.
--
-- Column rename: V72 added `pro_welcome_sent_at`; `Subscription.java`'s field and @Column now read
-- `plus_welcome_sent_at`, so the physical column has to follow or Hibernate validation fails on
-- startup (ddl-auto stays `validate`).
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('subscriptions') AND name = 'pro_welcome_sent_at'
)
BEGIN
    EXEC sp_rename 'subscriptions.pro_welcome_sent_at', 'plus_welcome_sent_at', 'COLUMN';
END

-- Data rename: `BillingPlan.PRO` is now `BillingPlan.PLUS`, and `billing_plan` stores the enum
-- name as text (see V56's comment on why it's `billing_plan` NVARCHAR, not an `is_pro` bit). Every
-- existing PRO row has to read PLUS or SubscriptionService's JPA @Enumerated(STRING) mapping fails
-- to deserialize it on the next read.
UPDATE subscriptions SET billing_plan = 'PLUS' WHERE billing_plan = 'PRO';
