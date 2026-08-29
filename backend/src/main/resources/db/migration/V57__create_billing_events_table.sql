-- Observability trail for the billing lifecycle, modelled on registration_events (V44) and there
-- for the same reason: an async dispatch mechanism must never have a code path where "the event
-- never arrived" and "it arrived and nothing went wrong" look identical from the outside.
--
-- Records every webhook we accept or reject, every reconcile, and every disagreement the
-- reconciliation watchdog finds between Stripe and this database. `detail` carries the real reason
-- (the Stripe error code, the signature failure, the two statuses that disagreed) rather than a
-- restatement of event_type -- the same rule registration_events follows.
--
-- Never stores card data, a raw webhook body, or any Stripe secret. account_id is nullable because
-- a rejected or unattributable event still deserves a row: an event we could not match to a
-- household is precisely the kind of thing that must not vanish silently.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'billing_events')
BEGIN
    CREATE TABLE billing_events (
        id               BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        account_id       BIGINT NULL,
        stripe_event_id  NVARCHAR(255) NULL,
        event_type       NVARCHAR(60) NOT NULL,
        detail           NVARCHAR(1000) NULL,
        created_at       DATETIME2 NOT NULL CONSTRAINT DF_billing_events_created_at DEFAULT GETDATE()
    );
END

-- ⚠️ This index IS the webhook idempotency mechanism. Stripe redelivers events -- on its own retry
-- schedule, and on demand from the Dashboard -- so the same stripe_event_id will arrive more than
-- once as a matter of course. The duplicate insert failing here is the dedup point; there is
-- deliberately no hand-rolled "have I seen this?" SELECT to drift out of sync with it.
--
-- Filtered to non-null because rows we write ourselves (a reconcile, a watchdog correction) carry
-- no Stripe event id and must not collide with each other.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_billing_events_stripe_event_id')
BEGIN
    CREATE UNIQUE INDEX UX_billing_events_stripe_event_id ON billing_events(stripe_event_id)
        WHERE stripe_event_id IS NOT NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_billing_events_created_at')
BEGIN
    CREATE INDEX IX_billing_events_created_at ON billing_events(created_at DESC);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_billing_events_account_id')
BEGIN
    CREATE INDEX IX_billing_events_account_id ON billing_events(account_id) WHERE account_id IS NOT NULL;
END
