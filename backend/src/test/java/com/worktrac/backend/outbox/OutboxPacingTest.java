package com.worktrac.backend.outbox;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

// Emails are paced to the per-minute quota Azure has granted: an email row due while the last
// minute's sends already fill it waits a few seconds -- without spending one of its attempts -- rather
// than being sent into an ACS throttle and burning a retry.
@TestPropertySource(properties = "app.outbox.email-sends-per-minute=2")
class OutboxPacingTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, OutboxPacingTest.class);
    }

    record Payload(String value) {
    }

    static class Handlers implements OutboxHandlerProvider {
        final List<String> delivered = new CopyOnWriteArrayList<>();

        @Override
        public List<OutboxHandler<?>> outboxHandlers() {
            return List.of(
                    new OutboxHandler<>("email.test-paced", Payload.class,
                            p -> delivered.add("email:" + p.value()), (p, reason) -> { }),
                    new OutboxHandler<>("test.not-an-email", Payload.class,
                            p -> delivered.add("other:" + p.value()), (p, reason) -> { }));
        }
    }

    @TestConfiguration
    static class Config {
        @Bean
        Handlers pacingHandlers() {
            return new Handlers();
        }
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private OutboxDispatcher dispatcher;

    @Autowired
    private OutboxPayloadCipher cipher;

    @Autowired
    private Handlers handlers;

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        jdbc.update("DELETE FROM outbox");
        handlers.delivered.clear();
    }

    private void sentInTheLastMinute(int count) {
        for (int i = 0; i < count; i++) {
            jdbc.update("INSERT INTO outbox (handler, status, completed_at) VALUES ('email.verification-code', 'SENT', SYSUTCDATETIME())");
        }
    }

    private long pending(String handler, String value) {
        return jdbc.queryForObject("INSERT INTO outbox (handler, payload) OUTPUT inserted.id VALUES (?, ?)",
                Long.class, handler, cipher.encrypt("{\"value\":\"" + value + "\"}"));
    }

    @Test
    void anEmailWaitsWhileTheLastMinuteIsFullAndKeepsItsAttempts() {
        sentInTheLastMinute(2);
        long id = pending("email.test-paced", "x");

        dispatcher.pollDue();

        assertThat(handlers.delivered).isEmpty();
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT status, attempts, claimed_until, CASE WHEN next_attempt_at > SYSUTCDATETIME() THEN 1 ELSE 0 END AS later "
                        + "FROM outbox WHERE id = ?", id);
        assertThat(row.get("status")).isEqualTo("PENDING");
        assertThat(row.get("attempts")).as("waiting for quota is not a failed attempt").isEqualTo(0);
        assertThat(row.get("claimed_until")).isNull();
        assertThat(row.get("later")).isEqualTo(1);
    }

    @Test
    void itGoesOutOnceTheMinuteHasRoomAgain() {
        sentInTheLastMinute(2);
        long id = pending("email.test-paced", "y");
        dispatcher.pollDue();

        jdbc.update("UPDATE outbox SET completed_at = DATEADD(MINUTE, -2, SYSUTCDATETIME()) WHERE status = 'SENT'");
        jdbc.update("UPDATE outbox SET next_attempt_at = DATEADD(SECOND, -1, SYSUTCDATETIME()) WHERE id = ?", id);
        dispatcher.pollDue();

        assertThat(handlers.delivered).containsExactly("email:y");
    }

    @Test
    void workThatIsNotAnEmailIsNeverPaced() {
        sentInTheLastMinute(2);
        pending("test.not-an-email", "z");

        dispatcher.pollDue();

        assertThat(handlers.delivered).containsExactly("other:z");
    }
}
