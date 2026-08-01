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

// Sends registration emails only after the triggering transaction has actually committed, and
// off the request thread -- RegistrationService publishes an event instead of calling
// EmailService directly, so a slow or failing Azure Communication Services call can no longer
// roll back an otherwise-successful account creation (it used to run synchronously inside the
// same @Transactional method, so a send failure or timeout would abort the whole transaction).
// Failures are logged AND recorded via RegistrationAuditService (for the two registration
// cases below), not rethrown: nothing downstream is waiting on this thread's outcome, but a
// send outcome must never vanish with zero trace -- that invisibility is exactly what made a
// real stuck-registration production incident undiagnosable.
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
        try {
            String messageId = emailService.sendVerificationCode(event.email(), event.rawCode());
            auditService.record(event.email(), RegistrationEventType.VERIFICATION_EMAIL_SENT, null, null, messageId);
        } catch (Exception e) {
            log.error("Failed to send verification code email to {}", event.email(), e);
            auditService.record(event.email(), RegistrationEventType.VERIFICATION_EMAIL_FAILED, failureReason(e), null);
        }
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRegistrationConfirmed(RegistrationConfirmedEvent event) {
        try {
            String messageId = emailService.sendRegistrationSuccess(event.email());
            auditService.record(event.email(), RegistrationEventType.SUCCESS_EMAIL_SENT, null, null, messageId);
        } catch (Exception e) {
            log.error("Failed to send registration-success email to {}", event.email(), e);
            auditService.record(event.email(), RegistrationEventType.SUCCESS_EMAIL_FAILED, failureReason(e), null);
        }
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPasswordResetCodeIssued(PasswordResetCodeIssuedEvent event) {
        try {
            emailService.sendPasswordResetCode(event.email(), event.rawCode());
        } catch (Exception e) {
            log.error("Failed to send password-reset code email to {}", event.email(), e);
        }
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPasswordResetConfirmed(PasswordResetConfirmedEvent event) {
        try {
            emailService.sendPasswordResetSuccess(event.email());
        } catch (Exception e) {
            log.error("Failed to send password-reset-success email to {}", event.email(), e);
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
