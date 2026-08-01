package com.worktrac.backend.registrationaudit;

import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.email.EmailService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Pure unit test (no Spring context) for the new ADMIN_ALERT_FAILED visibility: if the admin
// alert email itself fails to send, that must be recorded (not just logged), since otherwise
// "the underlying failure happened but nobody was actually notified" would itself be a blind
// spot with no trace anywhere.
class AdminAlertEventListenerTest {

    private AdminProperties adminProperties() {
        AdminProperties properties = new AdminProperties();
        properties.setEmails(List.of("admin@example.com"));
        return properties;
    }

    // A real instance rather than a Mockito mock -- RegistrationAlertSettings is a Hibernate
    // @Entity, and this test is in the same package so its protected no-arg constructor +
    // existing public setters are directly usable, which sidesteps any bytecode-enhancement
    // interaction a mock of an entity class could otherwise run into.
    private RegistrationAlertSettings settingsWithSendFailureAlertsOn() {
        RegistrationAlertSettings settings = new RegistrationAlertSettings();
        settings.setAlertOnSendFailure(true);
        return settings;
    }

    @Test
    void anAlertSendFailureIsRecordedAsAdminAlertFailed() {
        RegistrationAlertSettingsService settingsService = mock(RegistrationAlertSettingsService.class);
        EmailService emailService = mock(EmailService.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        AdminAlertEventListener listener = new AdminAlertEventListener(settingsService, adminProperties(),
                emailService, auditService);

        when(settingsService.get()).thenReturn(settingsWithSendFailureAlertsOn());
        doThrow(new RuntimeException("ACS unavailable"))
                .when(emailService).sendAdminAlert(any(), anyString(), anyString());

        listener.onRegistrationAlertEvent(
                new RegistrationAlertEvent(RegistrationEventType.VERIFICATION_EMAIL_FAILED, "stuck@example.com",
                        "ACS send did not succeed"));

        verify(auditService).record(eq("stuck@example.com"), eq(RegistrationEventType.ADMIN_ALERT_FAILED),
                contains("VERIFICATION_EMAIL_FAILED"), any());
    }

    // Recording the failure itself must never recurse: ADMIN_ALERT_FAILED is deliberately not an
    // alertable type, so RegistrationAuditService (the real implementation, not mocked here)
    // would never publish another RegistrationAlertEvent for it -- this test only proves the
    // listener doesn't blow up if that audit-write itself also fails, which would otherwise
    // escape this @Async method uncaught.
    @Test
    void aFailureToRecordAdminAlertFailedDoesNotEscapeTheListener() {
        RegistrationAlertSettingsService settingsService = mock(RegistrationAlertSettingsService.class);
        EmailService emailService = mock(EmailService.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        AdminAlertEventListener listener = new AdminAlertEventListener(settingsService, adminProperties(),
                emailService, auditService);

        when(settingsService.get()).thenReturn(settingsWithSendFailureAlertsOn());
        doThrow(new RuntimeException("ACS unavailable"))
                .when(emailService).sendAdminAlert(any(), anyString(), anyString());
        doThrow(new RuntimeException("DB also down"))
                .when(auditService).record(anyString(), eq(RegistrationEventType.ADMIN_ALERT_FAILED), anyString(),
                        any());

        listener.onRegistrationAlertEvent(
                new RegistrationAlertEvent(RegistrationEventType.VERIFICATION_EMAIL_FAILED, "stuck2@example.com",
                        "ACS send did not succeed"));
        // No assertion beyond "did not throw" -- reaching this line is the test.
    }
}
