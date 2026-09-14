-- The Pro -> Plus rename (V73) covered `subscriptions`, but not `billing_events`. Two
-- BillingEventType values still spelled the old name: PRO_WELCOME_EMAIL_SENT and
-- PRO_WELCOME_EMAIL_FAILED. Both are @Enumerated(STRING), so the enum name is what sits in
-- `billing_events.event_type` as text -- exactly the situation V73's own data rename addressed for
-- `billing_plan`.
--
-- ⚠️ WHY THIS CANNOT WAIT. A real `BillingPlan.PRO` (the personal-trainer tier) is about to exist.
-- From that point on a row reading PRO_WELCOME_EMAIL_SENT is not merely stale naming -- it is
-- actively false, because it records a Plus upgrade using the name of a different tier. The audit
-- trail is the thing you reach for when a welcome email did or did not go out, so a row that lies
-- about which tier it belongs to is worse than no row.
--
-- Unlike `billing_plan`, nothing DESERIALIZES this column back into the enum today
-- (BillingAuditService only ever writes, and the admin portal reads it as text), so a missed row
-- would not throw -- it would simply be invisible to any future query filtering on the new name.
-- That silence is the reason to do it now rather than to leave the old rows readable-but-wrong.
UPDATE billing_events SET event_type = 'PLUS_WELCOME_EMAIL_SENT' WHERE event_type = 'PRO_WELCOME_EMAIL_SENT';
UPDATE billing_events SET event_type = 'PLUS_WELCOME_EMAIL_FAILED' WHERE event_type = 'PRO_WELCOME_EMAIL_FAILED';
