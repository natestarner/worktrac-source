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
    // An account created by signing up with Apple or Google (SocialSignInService). The provider
    // verified the address, so there is no REGISTER_STARTED / code / CONFIRM_SUCCESS sequence --
    // which is also why RegistrationDispatchWatchdog never expects a verification email for one.
    SOCIAL_SIGN_UP,
    // Apple's server-to-server notifications (AppleNotificationController). The person stopped
    // using their Apple ID with Huddle, or deleted it: the Apple identity is disconnected and the
    // login's sessions end. The detail says whether the login still has another way in.
    APPLE_CONSENT_REVOKED,
    APPLE_ACCOUNT_DELETED,
    // Hide My Email forwarding turned off / back on. While off, every email to that relay address
    // is dropped by Apple -- this is the row that explains a "sent" email nobody received.
    APPLE_EMAIL_DISABLED,
    APPLE_EMAIL_ENABLED,

    // A request to one of the three registration endpoints that never reached
    // RegistrationService at all -- a malformed body, a validation failure, a database
    // outage, or any other exception GlobalExceptionHandler had to catch. Deliberately one
    // catch-all type rather than one per handler; the detail string carries the specific
    // cause. See GlobalExceptionHandler's own comment for why this can never cover a genuine
    // full outage (recording it is itself a database write).
    UNEXPECTED_ERROR,

    // The member-login invite (phase 7). Same level-1 send outcome as every other flow here --
    // "did ACS accept it" -- and it earns audit coverage for the same reason password reset did:
    // an invitation that silently never arrives is indistinguishable, from the owner's side, from
    // one the recipient is ignoring.
    // The invite's "started" marker, recorded when the row is committed. The watchdog pairs it
    // with the SENT/FAILED types below -- without a started event there is nothing to reconcile
    // against, and a dispatch that never ran would leave no trace at all.
    MEMBER_INVITE_STARTED,
    MEMBER_INVITE_DISPATCH_MISSING,
    MEMBER_INVITE_EMAIL_SENT,
    MEMBER_INVITE_EMAIL_FAILED,
    MEMBER_JOINED_EMAIL_SENT,
    MEMBER_JOINED_EMAIL_FAILED,
    MEMBER_ACCEPTED_OWNER_EMAIL_SENT,
    MEMBER_ACCEPTED_OWNER_EMAIL_FAILED,
    MEMBER_REVOKED_EMAIL_SENT,
    MEMBER_REVOKED_EMAIL_FAILED,

    // Level 1: did ACS accept the send?
    VERIFICATION_EMAIL_SENT,
    VERIFICATION_EMAIL_FAILED,
    SUCCESS_EMAIL_SENT,
    SUCCESS_EMAIL_FAILED,

    // Same level-1 send outcome, for the sibling password-reset flow (PasswordResetService) --
    // a real production incident (a user not receiving their reset code) showed this flow had
    // zero audit coverage at all, only a bare log.error. EMAIL_DELIVERED/BOUNCED/etc. below
    // already apply to these sends too, correlated purely by messageId + recipient, so no
    // separate delivery-level types are needed here.
    PASSWORD_RESET_EMAIL_SENT,
    PASSWORD_RESET_EMAIL_FAILED,
    PASSWORD_RESET_SUCCESS_EMAIL_SENT,
    PASSWORD_RESET_SUCCESS_EMAIL_FAILED,

    // The user-facing emails queued in the last hour crossed the warning threshold (or the hard
    // cap) in ratelimit.GlobalEmailCap. Recorded at most once an hour under the email "system",
    // and alertable, so a spike -- marketing working, or a bot -- reaches a person before the hard
    // cap starts refusing sign-ups.
    EMAIL_VOLUME_HIGH,

    // ACS ACCEPTED a send but had not confirmed it when EmailService stopped waiting, so it was
    // deliberately not resent (resending an accepted email is what duplicated every email on
    // 2026-11-12). Recorded by EmailService for EVERY kind of email -- admin and Contact Us alerts
    // included -- once per recipient, carrying the messageId when there is one. Not alertable: it
    // is a normal state during an ACS slowdown. What resolves it is a delivery report for the same
    // messageId; RegistrationDispatchWatchdog records EMAIL_DELIVERY_REPORT_MISSING if none comes.
    EMAIL_SEND_UNCONFIRMED,

    // Level 2: what actually happened to it, reported by Event Grid after the fact.
    EMAIL_DELIVERED,
    EMAIL_BOUNCED,
    EMAIL_DELIVERY_FAILED,
    EMAIL_FILTERED_SPAM,
    EMAIL_SUPPRESSED,
    EMAIL_QUARANTINED,

    // The admin alert email itself failed to send (see AdminAlertEventListener) -- deliberately
    // NOT in RegistrationAuditService's ALERTABLE set (an alert about a failed alert would
    // recurse), but still recorded so this failure mode is visible in the Activity feed rather
    // than only a log line.
    ADMIN_ALERT_FAILED,

    // Recorded by RegistrationDispatchWatchdog: a REGISTER_STARTED with no corresponding
    // VERIFICATION_EMAIL_SENT/FAILED after a grace period -- the dispatch never ran at all (as
    // opposed to running and failing, which the types above already cover). This is the
    // safety net for failure modes not otherwise anticipated (e.g. the process being killed
    // mid-dispatch) -- see the watchdog's own comment.
    REGISTRATION_EMAIL_DISPATCH_MISSING,

    // Recorded by RegistrationDispatchWatchdog: an EMAIL_SEND_UNCONFIRMED with no delivery report
    // for its messageId after DELIVERY_REPORT_GRACE. Either ACS failed the send without reporting
    // it, or delivery reports have stopped reaching the webhook (a broken Event Grid subscription)
    // -- either way, nobody can say whether the email arrived. Alertable.
    EMAIL_DELIVERY_REPORT_MISSING
}
