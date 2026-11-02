package com.worktrac.backend.registrationaudit;

import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.outbox.Outbox;
import com.worktrac.backend.outbox.OutboxHandler;
import com.worktrac.backend.outbox.OutboxHandlerProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;

// Reacts to RegistrationAlertEvent (published by RegistrationAuditService alongside persisting
// an alertable RegistrationEvent) by checking whether the admin has that category of alert
// turned on in RegistrationAlertSettings, and if so, emailing every ADMIN_EMAILS address.
// Through the outbox (outbox.Outbox), like RegistrationEmailEventListener: the alert row commits with
// the registration-audit row it reacts to (RegistrationAuditService.record's own REQUIRES_NEW
// transaction), is sent after commit, survives the replica that wrote it, and is retried before it
// is reported as failed. An alert-send failure is recorded as ADMIN_ALERT_FAILED
// (visible in the Activity feed, not just a log line) so "the underlying failure happened but
// nobody was actually notified" isn't itself a blind spot -- deliberately not in
// RegistrationAuditService's ALERTABLE set, since an alert about a failed alert would recurse.
@Component
public class AdminAlertEventListener implements OutboxHandlerProvider {

    static final String ADMIN_ALERT = "email.admin-alert";

    private static final Logger log = LoggerFactory.getLogger(AdminAlertEventListener.class);

    private static final Set<RegistrationEventType> SEND_FAILURE_TYPES = Set.of(
            RegistrationEventType.VERIFICATION_EMAIL_FAILED,
            RegistrationEventType.SUCCESS_EMAIL_FAILED,
            RegistrationEventType.PASSWORD_RESET_EMAIL_FAILED,
            RegistrationEventType.PASSWORD_RESET_SUCCESS_EMAIL_FAILED,
            RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING,
            // Under the send-failure toggle: both mean "email is not reaching people the way it
            // should", and one toggle for that is easier to reason about than two.
            RegistrationEventType.EMAIL_VOLUME_HIGH);

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
    private final Outbox outbox;

    public AdminAlertEventListener(RegistrationAlertSettingsService settingsService, AdminProperties adminProperties,
                                    EmailService emailService, RegistrationAuditService auditService, Outbox outbox) {
        this.settingsService = settingsService;
        this.adminProperties = adminProperties;
        this.emailService = emailService;
        this.auditService = auditService;
        this.outbox = outbox;
    }

    @EventListener
    public void onRegistrationAlertEvent(RegistrationAlertEvent event) {
        outbox.enqueue(ADMIN_ALERT, event);
    }

    @Override
    public List<OutboxHandler<?>> outboxHandlers() {
        return List.of(new OutboxHandler<>(ADMIN_ALERT, RegistrationAlertEvent.class,
                this::deliver,
                (event, reason) -> {
                    log.error("Gave up sending admin alert email for {} ({}): {}", event.email(), event.eventType(), reason);
                    try {
                        auditService.record(event.email(), RegistrationEventType.ADMIN_ALERT_FAILED,
                                "Alert for " + event.eventType() + " failed to send: " + reason, null);
                    } catch (Exception recordFailure) {
                        log.error("Failed to persist ADMIN_ALERT_FAILED for {} ({})", event.email(), event.eventType(),
                                recordFailure);
                    }
                }));
    }

    // The settings are read when the alert is sent, as before, so turning a category off also stops
    // alerts of that category still queued.
    private void deliver(RegistrationAlertEvent event) {
        RegistrationAlertSettings settings = settingsService.get();
        if (!shouldAlert(event.eventType(), settings)) {
            return;
        }

        String subject = "Huddle registration alert: " + event.eventType();
        String body = "Email: " + event.email() + "\nEvent: " + event.eventType()
                + "\nDetail: " + (event.detail() == null ? "(none)" : event.detail());

        // A send failure propagates, so the outbox retries it; the give-up above records it.
        emailService.sendAdminAlert(adminProperties.normalizedEmails(), subject, body);
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
