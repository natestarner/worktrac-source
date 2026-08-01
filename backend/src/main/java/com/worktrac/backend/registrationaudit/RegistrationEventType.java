package com.worktrac.backend.registrationaudit;

// The full registration lifecycle, from form submit through account creation, plus the
// two levels of email truth: SENT/FAILED is only "did Azure Communication Services accept
// the send" -- DELIVERED/BOUNCED/etc. is the real outcome, reported later (asynchronously,
// out of band) via an Event Grid delivery-report webhook and correlated by messageId.
public enum RegistrationEventType {
    REGISTER_STARTED,
    REGISTER_DUPLICATE_EMAIL,
    REGISTER_RATE_LIMITED,
    RESEND_REQUESTED,
    RESEND_THROTTLED,
    RESEND_NOT_FOUND,
    CONFIRM_SUCCESS,
    CONFIRM_WRONG_CODE,
    CONFIRM_EXPIRED,
    CONFIRM_LOCKED,
    CONFIRM_NOT_FOUND,

    // A request to one of the three registration endpoints that never reached
    // RegistrationService at all -- a malformed body, a validation failure, a database
    // outage, or any other exception GlobalExceptionHandler had to catch. Deliberately one
    // catch-all type rather than one per handler; the detail string carries the specific
    // cause. See GlobalExceptionHandler's own comment for why this can never cover a genuine
    // full outage (recording it is itself a database write).
    UNEXPECTED_ERROR,

    // Level 1: did ACS accept the send?
    VERIFICATION_EMAIL_SENT,
    VERIFICATION_EMAIL_FAILED,
    SUCCESS_EMAIL_SENT,
    SUCCESS_EMAIL_FAILED,

    // Level 2: what actually happened to it, reported by Event Grid after the fact.
    EMAIL_DELIVERED,
    EMAIL_BOUNCED,
    EMAIL_DELIVERY_FAILED,
    EMAIL_FILTERED_SPAM,
    EMAIL_SUPPRESSED,
    EMAIL_QUARANTINED
}
