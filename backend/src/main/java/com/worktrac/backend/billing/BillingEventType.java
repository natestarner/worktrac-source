package com.worktrac.backend.billing;

// One value per meaningful billing lifecycle moment. Mirrors RegistrationEventType's role: the
// enum names WHAT happened, and billing_events.detail carries WHY (the Stripe error code, the two
// statuses that disagreed, the reason a webhook was rejected). A detail that merely restates the
// event type is a wasted row -- see .claude/rules/registration-and-email.md.
public enum BillingEventType {

    // A checkout session was created for a household. Proves intent, never payment.
    CHECKOUT_STARTED,

    // The browser came back from Stripe and we read the session directly. This -- not the webhook
    // -- is what makes the success screen immediate.
    CHECKOUT_RECONCILED,

    // A Customer Portal session was handed out.
    PORTAL_OPENED,

    // A signed webhook we accepted and applied.
    WEBHOOK_APPLIED,

    // A signed webhook for an event type we understand but deliberately ignore. Recorded so
    // "we chose not to act" stays distinguishable from "it never arrived".
    WEBHOOK_IGNORED,

    // Signature verification failed, or the payload could not be attributed to a household.
    WEBHOOK_REJECTED,

    // The reconciliation watchdog found Stripe and this database disagreeing, and corrected us.
    // An alertable condition: it means a webhook was missed.
    RECONCILE_DRIFT_CORRECTED,

    // A subscription was cancelled because its household was deleted.
    CANCELED_ON_ACCOUNT_DELETION,

    // The welcome-to-Plus email (PlusUpgradedEvent) was sent, or failed to send. Isolated from the
    // audit WRITE the same way registration email outcomes are -- see PlusUpgradeEmailEventListener.
    PLUS_WELCOME_EMAIL_SENT,
    PLUS_WELCOME_EMAIL_FAILED,

    // An admin granted or removed a comp through the admin portal. These two are the AUDIT TRAIL
    // for the portal's plan-granting action, and they are the reason it is safe to have one: a
    // capability to hand out paid plans is only as accountable as its record.
    //
    // ⚠️ `detail` must always name the ACTING ADMIN, and that email comes from the authenticated
    // principal (CurrentUser), never from the request body -- a self-reported actor is not an
    // audit trail. It also carries the tier, the band and the admin's note, because "what was
    // granted" is the other half of the question a review asks.
    //
    // Recorded through BillingAuditService, which is REQUIRES_NEW: the row survives even if the
    // grant transaction rolls back afterwards. That bias is deliberate here -- an audit row for a
    // grant that did not land is a puzzle, while a grant that landed with no row is a hole.
    COMP_GRANTED,
    COMP_REVOKED
}
