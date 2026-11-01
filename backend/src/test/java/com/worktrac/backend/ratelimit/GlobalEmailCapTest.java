package com.worktrac.backend.ratelimit;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationEvent;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.assertj.core.api.Assertions.assertThat;

// The global email caps, counted from the outbox. Rows are written straight into the table: that is
// what every replica's emails look like to this replica, and it is the whole point -- the cap is one
// number across all of them, not a bucket per JVM.
@TestPropertySource(properties = {
        "app.rate-limit.global-email-warning-per-hour=3",
        "app.rate-limit.global-email-sends-per-hour=5"})
class GlobalEmailCapTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, GlobalEmailCapTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private GlobalEmailCap cap;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private RegistrationEventRepository events;

    @BeforeEach
    void reset() {
        jdbc.update("DELETE FROM outbox");
        jdbc.update("DELETE FROM registration_events WHERE event_type = 'EMAIL_VOLUME_HIGH'");
    }

    // Queued by some replica: status and payload don't matter to the cap, only that it was queued.
    private void queued(String handler, int count) {
        for (int i = 0; i < count; i++) {
            jdbc.update("INSERT INTO outbox (handler, payload, status) VALUES (?, NULL, 'SENT')", handler);
        }
    }

    private long warnings() {
        return events.findAll().stream()
                .map(RegistrationEvent::getEventType)
                .filter(type -> type == RegistrationEventType.EMAIL_VOLUME_HIGH)
                .count();
    }

    @Test
    void belowTheWarningEverythingIsAllowedQuietly() {
        queued("email.verification-code", 2);

        assertThat(cap.tryAllow()).isTrue();
        assertThat(warnings()).isZero();
    }

    @Test
    void theWarningAlertsOnceAndRefusesNothing() {
        queued("email.verification-code", 3);

        assertThat(cap.tryAllow()).isTrue();
        queued("email.password-reset-code", 1);
        assertThat(cap.tryAllow()).isTrue();

        assertThat(warnings()).as("one alert an hour, however many requests cross the line").isEqualTo(1);
    }

    @Test
    void theHardCapRefusesAcrossEveryReplicasEmails() {
        queued("email.verification-code", 3);
        queued("email.registration-success", 2);

        assertThat(cap.tryAllow()).isFalse();
    }

    @Test
    void mailToTheAdminNeverCountsAndIsNeverRefused() {
        queued("email.admin-alert", 50);
        queued("email.contact-alert", 50);
        queued("stripe.cancel-on-account-deletion", 50);

        assertThat(cap.tryAllow()).isTrue();
        assertThat(warnings()).isZero();
    }

    @Test
    void emailsQueuedOverAnHourAgoNoLongerCount() {
        queued("email.verification-code", 5);
        jdbc.update("UPDATE outbox SET created_at = DATEADD(MINUTE, -61, SYSUTCDATETIME())");

        assertThat(cap.tryAllow()).isTrue();
    }
}
