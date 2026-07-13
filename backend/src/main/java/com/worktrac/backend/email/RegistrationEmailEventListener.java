package com.worktrac.backend.email;

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
// Failures are logged, not rethrown: nothing downstream is waiting on this thread's outcome.
@Component
public class RegistrationEmailEventListener {

    private static final Logger log = LoggerFactory.getLogger(RegistrationEmailEventListener.class);

    private final EmailService emailService;

    public RegistrationEmailEventListener(EmailService emailService) {
        this.emailService = emailService;
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onVerificationCodeIssued(VerificationCodeIssuedEvent event) {
        try {
            emailService.sendVerificationCode(event.email(), event.rawCode());
        } catch (Exception e) {
            log.error("Failed to send verification code email to {}", event.email(), e);
        }
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRegistrationConfirmed(RegistrationConfirmedEvent event) {
        try {
            emailService.sendRegistrationSuccess(event.email());
        } catch (Exception e) {
            log.error("Failed to send registration-success email to {}", event.email(), e);
        }
    }
}
