package com.worktrac.backend.email;

import com.worktrac.backend.membership.MembershipAcceptedEvent;
import com.worktrac.backend.membership.MembershipInviteIssuedEvent;
import com.worktrac.backend.membership.MembershipRevokedEvent;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.user.PasswordResetCodeIssuedEvent;
import com.worktrac.backend.user.PasswordResetConfirmedEvent;
import com.worktrac.backend.user.RegistrationConfirmedEvent;
import com.worktrac.backend.user.VerificationCodeIssuedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.event.TransactionPhase;

// Sends registration and password-reset emails only after the triggering transaction has
// actually committed, and off the request thread -- the originating services publish an event
// instead of calling EmailService directly, so a slow or failing Azure Communication Services
// call can no longer roll back an otherwise-successful account creation/password change (it
// used to run synchronously inside the same @Transactional method, so a send failure or
// timeout would abort the whole transaction).
//
// Every outcome is recorded via RegistrationAuditService, not just logged: nothing downstream
// is waiting on this thread's outcome, but a send outcome must never vanish with zero trace --
// that invisibility is exactly what made a real stuck-registration production incident
// undiagnosable. Each handler below deliberately records the SENT audit event in its own
// try/catch, separate from the one around the send itself -- if the send succeeds but the
// *audit write* then throws (a transient DB hiccup at that exact moment), that failure must
// not be misreported as an EMAIL_FAILED event, since the email genuinely went out. recordSafely
// gives that secondary failure its own loud, distinctly-labeled log line instead of silently
// escaping this @Async void method (where an uncaught exception would only reach Spring's
// default AsyncUncaughtExceptionHandler, several steps removed from anything actionable).
@Component
public class RegistrationEmailEventListener {

    private static final Logger log = LoggerFactory.getLogger(RegistrationEmailEventListener.class);

    private final EmailService emailService;
    private final RegistrationAuditService auditService;

    public RegistrationEmailEventListener(EmailService emailService, RegistrationAuditService auditService) {
        this.emailService = emailService;
        this.auditService = auditService;
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onVerificationCodeIssued(VerificationCodeIssuedEvent event) {
        sendAndRecord(event.email(),
                () -> emailService.sendVerificationCode(event.email(), event.rawCode()),
                RegistrationEventType.VERIFICATION_EMAIL_SENT,
                RegistrationEventType.VERIFICATION_EMAIL_FAILED,
                "verification code");
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRegistrationConfirmed(RegistrationConfirmedEvent event) {
        sendAndRecord(event.email(),
                () -> emailService.sendRegistrationSuccess(event.email()),
                RegistrationEventType.SUCCESS_EMAIL_SENT,
                RegistrationEventType.SUCCESS_EMAIL_FAILED,
                "registration-success");
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPasswordResetCodeIssued(PasswordResetCodeIssuedEvent event) {
        sendAndRecord(event.email(),
                () -> emailService.sendPasswordResetCode(event.email(), event.rawCode()),
                RegistrationEventType.PASSWORD_RESET_EMAIL_SENT,
                RegistrationEventType.PASSWORD_RESET_EMAIL_FAILED,
                "password-reset code");
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPasswordResetConfirmed(PasswordResetConfirmedEvent event) {
        sendAndRecord(event.email(),
                () -> emailService.sendPasswordResetSuccess(event.email()),
                RegistrationEventType.PASSWORD_RESET_SUCCESS_EMAIL_SENT,
                RegistrationEventType.PASSWORD_RESET_SUCCESS_EMAIL_FAILED,
                "password-reset-success");
    }

    /**
     * The member-login invite.
     *
     * <p>Lives here rather than in a second listener on purpose: this is the same job — send an
     * email after the transaction commits, off the request thread, and record the outcome either
     * way — and a second component doing it would be a second mechanism to keep in step with
     * {@code sendAndRecord}'s two-try/catch structure.
     *
     * <p>⚠️ A failure here is NOT recoverable by resending: the raw token exists only on this
     * event, and the row holds a BCrypt hash that cannot reproduce it. The owner has to re-issue,
     * which mints a new secret. That is exactly why the failure is audited rather than logged —
     * an invitation that silently never arrived looks, from the owner's side, identical to one the
     * recipient is ignoring.
     */
    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onMembershipInviteIssued(MembershipInviteIssuedEvent event) {
        sendAndRecord(event.email(),
                () -> emailService.sendMembershipInvite(event.email(), event.personName(),
                        event.householdName(), event.ownerName(),
                        emailService.joinUrl(event.inviteId(), event.rawToken()),
                        event.recipientHasAccount()),
                RegistrationEventType.MEMBER_INVITE_EMAIL_SENT,
                RegistrationEventType.MEMBER_INVITE_EMAIL_FAILED,
                "membership invite");
    }

    /**
     * An invitation was accepted: TWO sends, to two people, for two different reasons.
     *
     * <p>They are separate {@code sendAndRecord} calls rather than one, because either can fail on
     * its own and the audit trail has to say which. The owner's is the typo detector; the member's
     * carries the household name and the way out.
     */
    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onMembershipAccepted(MembershipAcceptedEvent event) {
        sendAndRecord(event.memberEmail(),
                () -> emailService.sendAddedToHousehold(event.memberEmail(), event.personName(),
                        event.householdName(), event.ownerName()),
                RegistrationEventType.MEMBER_JOINED_EMAIL_SENT,
                RegistrationEventType.MEMBER_JOINED_EMAIL_FAILED,
                "added to household");

        sendAndRecord(event.ownerEmail(),
                () -> emailService.sendInviteAccepted(event.ownerEmail(), event.memberEmail(),
                        event.personName(), event.householdName()),
                RegistrationEventType.MEMBER_ACCEPTED_OWNER_EMAIL_SENT,
                RegistrationEventType.MEMBER_ACCEPTED_OWNER_EMAIL_FAILED,
                "invite accepted (owner)");
    }

    /**
     * A login was removed, or an invitation withdrawn.
     *
     * <p>⚠️ A security control rather than a courtesy: without it somebody is silently signed out,
     * and their queued offline writes can then never land. Audited for the same reason — a notice
     * that quietly failed to send would leave them with no explanation at all.
     */
    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onMembershipRevoked(MembershipRevokedEvent event) {
        sendAndRecord(event.memberEmail(),
                () -> emailService.sendLoginRevoked(event.memberEmail(), event.householdName(),
                        event.ownerName(), event.wasOnlyAnInvitation()),
                RegistrationEventType.MEMBER_REVOKED_EMAIL_SENT,
                RegistrationEventType.MEMBER_REVOKED_EMAIL_FAILED,
                "login revoked");
    }

    // Common shape for all four handlers above: attempt the send; only a failure *of the send
    // itself* is classified as the failedType. Recording the outcome (either branch) is
    // isolated in its own try/catch via recordSafely so a failure to persist the audit row can
    // never be conflated with the email itself having failed.
    private void sendAndRecord(String email, EmailSend send, RegistrationEventType sentType,
                                RegistrationEventType failedType, String description) {
        String messageId;
        try {
            messageId = send.execute();
        } catch (Exception e) {
            log.error("Failed to send {} email to {}", description, email, e);
            recordSafely(email, failedType, failureReason(e), null);
            return;
        }
        recordSafely(email, sentType, null, messageId);
    }

    @FunctionalInterface
    private interface EmailSend {
        String execute() throws Exception;
    }

    private void recordSafely(String email, RegistrationEventType type, String detail, String messageId) {
        try {
            auditService.record(email, type, detail, null, messageId);
        } catch (Exception e) {
            log.error("Failed to persist registration-audit event {} for {} (detail={})", type, email, detail, e);
        }
    }

    // Builds a real, human-readable reason string instead of just the exception's class name --
    // EmailSendException's message already carries the ACS status/code/message (see
    // EmailService.describeFailure); any other exception (network failure, timeout, ACS SDK
    // HTTP-level error) falls back to its own message.
    private String failureReason(Exception e) {
        String message = e.getMessage();
        if (message != null && !message.isBlank()) {
            return e.getClass().getSimpleName() + ": " + message;
        }
        return e.getClass().getSimpleName();
    }
}
