package com.worktrac.backend.email;

import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.contact.ContactAlertStatusService;
import com.worktrac.backend.contact.ContactMessageReceivedEvent;
import com.worktrac.backend.registrationaudit.RegistrationAlertSettingsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

// Emails ADMIN_EMAILS when someone submits the Contact Us form.
//
// AFTER_COMMIT + @Async for the same reasons as RegistrationEmailEventListener and
// AdminAlertEventListener: this must never run inside (or be able to roll back) the message write
// it is reacting to, and nothing is waiting on its outcome. Unlike those two, the outcome is
// recorded on the contact_messages row itself rather than as a separate audit event -- the row
// already exists and is the thing the admin reads, so putting the send status beside the message
// means "was I actually told about this?" is answerable without correlating two tables.
//
// The SEND and the STATUS WRITE are isolated in separate try/catches, per registration-and-email.md:
// if the send succeeds but the status write then throws (a transient DB hiccup at that exact
// moment), that must not be recorded as a send failure -- the email genuinely went out.
@Component
public class ContactEmailEventListener {

    private static final Logger log = LoggerFactory.getLogger(ContactEmailEventListener.class);

    // Keeps the alert body well under any provider's practical size limit while leaving plenty of
    // room to read a real report. The full text is always in the admin portal.
    private static final int MAX_BODY_MESSAGE_CHARS = 2000;

    private final EmailService emailService;
    private final AdminProperties adminProperties;
    private final RegistrationAlertSettingsService settingsService;
    private final ContactAlertStatusService alertStatusService;

    public ContactEmailEventListener(EmailService emailService, AdminProperties adminProperties,
                                      RegistrationAlertSettingsService settingsService,
                                      ContactAlertStatusService alertStatusService) {
        this.emailService = emailService;
        this.adminProperties = adminProperties;
        this.settingsService = settingsService;
        this.alertStatusService = alertStatusService;
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onContactMessageReceived(ContactMessageReceivedEvent event) {
        if (!settingsService.get().isAlertOnContactMessage()) {
            // Deliberately leaves alert_status at PENDING rather than inventing a fourth state: the
            // admin turned alerts off, so "nobody was emailed" is the configured outcome, and the
            // portal is where they read these anyway.
            return;
        }

        String messageId;
        try {
            messageId = emailService.sendAdminAlert(adminProperties.normalizedEmails(), buildSubject(event),
                    buildBody(event));
        } catch (Exception e) {
            log.error("Failed to send contact-message alert for contact message {}", event.contactMessageId(), e);
            recordSafely(() -> alertStatusService.recordFailed(event.contactMessageId(), failureReason(e)),
                    event.contactMessageId());
            return;
        }
        recordSafely(() -> alertStatusService.recordSent(event.contactMessageId(), messageId),
                event.contactMessageId());
    }

    // The subject embeds text a household member typed, and a subject line is an email HEADER --
    // a bare CR or LF in it is header injection. Strip them (and collapse the whitespace they leave
    // behind) before anything reaches the mail API, then bound the length.
    private String buildSubject(ContactMessageReceivedEvent event) {
        String sanitized = event.subject().replaceAll("[\\r\\n]", " ").replaceAll("\\s+", " ").trim();
        if (sanitized.length() > 120) {
            sanitized = sanitized.substring(0, 120);
        }
        return "Huddle contact [" + event.category() + "]: " + sanitized;
    }

    // Plain text, matching sendAdminAlert's plain-text-only contract -- with no HTML part, markup in
    // the person's message has nothing to inject into. The correlation id is included because it is
    // the whole point of the triage workflow: paste it into the Log Analytics query in
    // docs/azure-read-only-access.md to get that person's request trail.
    private String buildBody(ContactMessageReceivedEvent event) {
        String message = event.message();
        String truncationNote = "";
        if (message.length() > MAX_BODY_MESSAGE_CHARS) {
            message = message.substring(0, MAX_BODY_MESSAGE_CHARS);
            truncationNote = "\n[truncated -- full message in Admin Portal > Contact]";
        }
        return "From: " + event.submitterEmail()
                + "\nCategory: " + event.category()
                + "\nCorrelation id: " + (event.correlationId() == null ? "(none)" : event.correlationId())
                + "\n\n" + message + truncationNote
                + "\n\n--\nRead it in the admin portal for the full diagnostics.";
    }

    // Isolates the status write from the send, so a DB failure here is never reported as an email
    // failure. Its own failure gets a loud, distinctly-labeled log line rather than escaping this
    // @Async void method into Spring's default AsyncUncaughtExceptionHandler.
    private void recordSafely(Runnable record, Long contactMessageId) {
        try {
            record.run();
        } catch (Exception e) {
            log.error("Failed to persist contact alert status for contact message {}", contactMessageId, e);
        }
    }

    // The real reason (the ACS status/code/message EmailSendException already carries), not just an
    // exception class name -- this string is what the admin portal shows beside a FAILED row.
    private String failureReason(Exception e) {
        String message = e.getMessage();
        if (message != null && !message.isBlank()) {
            return e.getClass().getSimpleName() + ": " + message;
        }
        return e.getClass().getSimpleName();
    }
}
