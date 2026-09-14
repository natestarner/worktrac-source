-- The Pro tier (personal trainers) is the first plan priced by SIZE rather than per household, and
-- the first that makes "which tier does a comp grant?" a real question. Two nullable columns, no
-- backfill needed for either -- see below for why each null is the right existing answer.
--
-- `billing_plan` itself is NOT widened or constrained here: it is NVARCHAR(20) storing the enum
-- NAME (V56), so 'PRO' fits and needs no DDL. There is deliberately no CHECK constraint on it --
-- V56 did not add one, and adding one now would mean a migration every time a tier is added, for a
-- value only @Enumerated(STRING) ever writes.

-- How many CLIENTS a Pro subscription is licensed for, from the band that was bought.
--
-- NULL means "no seat limit", which is correct for all three existing cases with no backfill: every
-- household tier (Free and Plus have no seats at all -- their ceiling is a family-shaped quota, not
-- a purchase), and Pro's own UNLIMITED band. Choosing a sentinel like 2147483647 instead would have
-- made "12 of 2147483647 clients" a string the billing screen could render.
--
-- ⚠️ A CEILING ON NEW CLIENTS, NEVER A REVOCATION. Nothing reads this to take access away; it is
-- checked when ADDING a person or sending an invite. A trainer who moves down a band keeps every
-- client they already have -- same promise the Plus pause makes.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('subscriptions') AND name = 'client_seats'
)
BEGIN
    ALTER TABLE subscriptions ADD client_seats INT NULL;
END

-- WHICH tier a comp grants, for the founding households in COMPED_EMAILS.
--
-- NULL means PLUS. That is not a default chosen for convenience -- it is what every existing comped
-- row already means, because Plus was the only paid tier when they were granted. So a backfill
-- would write a value that changes nothing, and the null is genuinely more honest: these rows were
-- granted before the question existed.
--
-- Separate from `billing_plan` on purpose. That column is a CACHE of present entitlement, rewritten
-- by applyStripeState on every Stripe event; this is the standing grant. Folding them together
-- would let a webhook about a lapsed card overwrite the comp that is meant to outlive it.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('subscriptions') AND name = 'comped_plan'
)
BEGIN
    ALTER TABLE subscriptions ADD comped_plan NVARCHAR(20) NULL;
END
