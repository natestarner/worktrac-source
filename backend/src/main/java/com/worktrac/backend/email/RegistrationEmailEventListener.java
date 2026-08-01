package com.worktrac.backend.email;

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
