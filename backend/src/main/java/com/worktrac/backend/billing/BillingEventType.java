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
    CANCELED_ON_ACCOUNT_DELETION
}
