package com.worktrac.backend.registrationaudit;

import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.email.EmailService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.event.TransactionPhase;

import java.util.Set;

// Reacts to RegistrationAlertEvent (published by RegistrationAuditService alongside persisting
// an alertable RegistrationEvent) by checking whether the admin has that category of alert
// turned on in RegistrationAlertSettings, and if so, emailing every ADMIN_EMAILS address.
// AFTER_COMMIT + @Async for the same reason as RegistrationEmailEventListener: this must never
// run inside (or be able to roll back) the registration-audit write it's reacting to, and
// nothing is waiting on its outcome. An alert-send failure is recorded as ADMIN_ALERT_FAILED
// (visible in the Activity feed, not just a log line) so "the underlying failure happened but
// nobody was actually notified" isn't itself a blind spot -- deliberately not in
// RegistrationAuditService's ALERTABLE set, since an alert about a failed alert would recurse.
@Component
public class AdminAlertEventListener {

    private static final Logger log = LoggerFactory.getLogger(AdminAlertEventListener.class);

    private static final Set<RegistrationEventType> SEND_FAILURE_TYPES = Set.of(
            RegistrationEventType.VERIFICATION_EMAIL_FAILED,
            RegistrationEventType.SUCCESS_EMAIL_FAILED,
            RegistrationEventType.PASSWORD_RESET_EMAIL_FAILED,
            RegistrationEventType.PASSWORD_RESET_SUCCESS_EMAIL_FAILED,
            RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING);

    private static final Set<RegistrationEventType> DELIVERY_FAILURE_TYPES = Set.of(
            RegistrationEventType.EMAIL_BOUNCED,
            RegistrationEventType.EMAIL_DELIVERY_FAILED,
            RegistrationEventType.EMAIL_FILTERED_SPAM,
            RegistrationEventType.EMAIL_SUPPRESSED,
            RegistrationEventType.EMAIL_QUARANTINED);

    private final RegistrationAlertSettingsService settingsService;
    private final AdminProperties adminProperties;
    private final EmailService emailService;
    private final RegistrationAuditService auditService;

    public AdminAlertEventListener(RegistrationAlertSettingsService settingsService, AdminProperties adminProperties,
                                    EmailService emailService, RegistrationAuditService auditService) {
        this.settingsService = settingsService;
        this.adminProperties = adminProperties;
        this.emailService = emailService;
        this.auditService = auditService;
    }

    @Async("emailTaskExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRegistrationAlertEvent(RegistrationAlertEvent event) {
        RegistrationAlertSettings settings = settingsService.get();
        if (!shouldAlert(event.eventType(), settings)) {
            return;
        }

        String subject = "Huddle registration alert: " + event.eventType();
        String body = "Email: " + event.email() + "\nEvent: " + event.eventType()
                + "\nDetail: " + (event.detail() == null ? "(none)" : event.detail());

        try {
            emailService.sendAdminAlert(adminProperties.normalizedEmails(), subject, body);
        } catch (Exception e) {
            log.error("Failed to send admin alert email for {} ({})", event.email(), event.eventType(), e);
            try {
                auditService.record(event.email(), RegistrationEventType.ADMIN_ALERT_FAILED,
                        "Alert for " + event.eventType() + " failed to send: " + e.getMessage(), null);
            } catch (Exception recordFailure) {
                log.error("Failed to persist ADMIN_ALERT_FAILED for {} ({})", event.email(), event.eventType(),
                        recordFailure);
            }
        }
    }

    private boolean shouldAlert(RegistrationEventType eventType, RegistrationAlertSettings settings) {
        if (eventType == RegistrationEventType.CONFIRM_SUCCESS) {
            return settings.isAlertOnRegistrationConfirmed();
        }
        if (SEND_FAILURE_TYPES.contains(eventType)) {
            return settings.isAlertOnSendFailure();
        }
        if (DELIVERY_FAILURE_TYPES.contains(eventType)) {
            return settings.isAlertOnDeliveryFailure();
        }
        return false;
    }
}
