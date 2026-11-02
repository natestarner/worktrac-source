package com.worktrac.backend.config;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.assertj.core.api.Assertions.assertThat;

// The health-metrics line is read by Log Analytics alert rules, so its values must be right and its
// format must not drift. Values against a real outbox table and the real Hikari pool.
class HealthMetricsLoggerTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HealthMetricsLoggerTest.class);
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private HealthMetricsLogger logger;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        jdbc.update("DELETE FROM outbox");
    }

    @Test
    void anEmptyOutboxReportsZeroBacklog() {
        HealthMetricsLogger.Snapshot snapshot = logger.snapshot();

        assertThat(snapshot.outboxPending()).isZero();
        assertThat(snapshot.outboxOldestPendingSeconds()).isZero();
        assertThat(snapshot.outboxFailedLastHour()).isZero();
    }

    @Test
    void theBacklogIsMeasuredFromTheOldestPendingRow() {
        jdbc.update("INSERT INTO outbox (handler, created_at) VALUES ('email.x', DATEADD(MINUTE, -10, SYSUTCDATETIME()))");
        jdbc.update("INSERT INTO outbox (handler) VALUES ('email.y')");
        jdbc.update("INSERT INTO outbox (handler, status, completed_at) VALUES ('email.z', 'FAILED', SYSUTCDATETIME())");
        jdbc.update("INSERT INTO outbox (handler, status, completed_at) VALUES ('email.old', 'FAILED', DATEADD(HOUR, -2, SYSUTCDATETIME()))");

        HealthMetricsLogger.Snapshot snapshot = logger.snapshot();

        assertThat(snapshot.outboxPending()).isEqualTo(2);
        assertThat(snapshot.outboxOldestPendingSeconds()).isBetween(595L, 660L);
        assertThat(snapshot.outboxFailedLastHour()).isEqualTo(1);
    }

    @Test
    void thePoolIsThisReplicasHikariPool() {
        HealthMetricsLogger.Snapshot snapshot = logger.snapshot();

        assertThat(snapshot.poolMax()).isPositive();
        assertThat(snapshot.poolTotal()).isPositive();
        assertThat(snapshot.poolWaiting()).isZero();
    }

    // The alert rules parse these keys. This is the pin: change it together with the KQL.
    @Test
    void theLineFormatIsStable() {
        String line = new HealthMetricsLogger.Snapshot(3, 42, 1, 2, 8, 10, 10, 0).line();

        assertThat(line).isEqualTo("health-metrics outboxPending=3 outboxOldestPendingSeconds=42 "
                + "outboxFailedLastHour=1 poolActive=2 poolIdle=8 poolTotal=10 poolMax=10 poolWaiting=0");
    }
}
