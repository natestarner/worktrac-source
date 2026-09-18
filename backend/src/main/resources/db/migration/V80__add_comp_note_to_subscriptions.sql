-- Why this household was comped, in the granting admin's own words.
--
-- Comps used to arrive one way only: an address added to COMPED_EMAILS and a redeploy, where the
-- secret itself was the record of who had been granted what and roughly why. Granting is an admin
-- portal action now (see .claude/rules/admin-portal.md's third sanctioned exception), so that
-- implicit record is gone and "why is this household on Pro?" needs an answer on the row.
--
-- WHO granted it and WHEN live in `billing_events` (COMP_GRANTED / COMP_REVOKED), which is the
-- append-only audit trail and the thing a security review reads. This column is deliberately NOT
-- that: it is the one-line reason the Accounts tab shows inline, so the common question is
-- answerable without a second query. Do not start writing the actor's identity here -- a mutable
-- column on the subscription is the wrong place for an audit fact.
--
-- NULL is legitimate and needs no backfill: every row comped before this existed was granted
-- through COMPED_EMAILS, where no note was ever captured. NVARCHAR(200) is a deliberate ceiling --
-- CompGrantService rejects anything longer rather than truncating, so an over-long note is a 400
-- the admin can see and fix rather than a silently-clipped record.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('subscriptions') AND name = 'comp_note'
)
BEGIN
    ALTER TABLE subscriptions ADD comp_note NVARCHAR(200) NULL;
END
