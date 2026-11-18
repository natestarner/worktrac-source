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
    COMP_REVOKED,

    // ---- App stores (In-App Purchase). See docs/in-app-purchase-plan.md. ----

    // The app asked to buy in a store and was handed the household token. Proves intent, never payment.
    STORE_PURCHASE_STARTED,

    // A store subscription's current state, re-fetched from the store, was written to the row.
    STORE_APPLIED,

    // A store purchase or message was refused: it failed verification, or it was about a subscription
    // that is not this household's and is not paying (an old, lapsed one).
    STORE_REJECTED,

    // A verified store purchase that names no household we know: no matching subscription id, and no
    // household token (or one belonging to a deleted household). Not applied. Apple's Set App Account
    // Token endpoint can stamp it once someone has worked out whose it is.
    STORE_UNMATCHED,

    // Two sources were paying for one household. The one we CAN cancel (Stripe, later Google Play) was
    // cancelled and its latest payment refunded in full; detail names which. Emails the owner.
    OVERLAP_REFUNDED,

    // Two sources we CANNOT cancel (two Apple IDs) were paying for one household. Nothing could be
    // undone automatically: an ops alert, and the owner is told which one to cancel in Settings.
    OVERLAP_UNCANCELLABLE,

    // A household paying through a store was deleted. We cannot cancel a store subscription, so the
    // delete screen told them to cancel it in Settings; this records that it was left running.
    STORE_LEFT_RUNNING_ON_DELETION
}
