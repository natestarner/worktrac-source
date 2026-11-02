package com.worktrac.backend.outbox;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.EmailTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// The outbox's own guarantees, against a real SQL Server: a row commits or rolls back with its
// transaction, is delivered after commit, is retried with backoff and then given up on (never
// silently dropped), survives the death of the replica holding it, and is delivered by exactly one
// of several replicas polling at once.
//
// Replicas share only the database, so "another replica" here is another thread calling the same
// dispatcher: the claim is a row-level UPDLOCK/READPAST statement in the database, not anything in
// this JVM. Retries are driven by hand (pollDue after moving next_attempt_at into the past) rather
// than by waiting out real backoff.
@TestPropertySource(properties = {"app.outbox.max-attempts=3", "app.outbox.backoff=PT1S"})
class OutboxTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, OutboxTest.class);
    }

    record TestPayload(String value) {
    }

    /** A handler whose behaviour each test sets: fail the first N attempts of a value, then succeed. */
    static class TestHandler implements OutboxHandlerProvider {
        static final String NAME = "test.recording";
        final Map<String, AtomicInteger> failuresLeft = new ConcurrentHashMap<>();
        final List<String> delivered = new CopyOnWriteArrayList<>();
        final List<String> gaveUp = new CopyOnWriteArrayList<>();

        @Override
        public List<OutboxHandler<?>> outboxHandlers() {
            return List.of(new OutboxHandler<>(NAME, TestPayload.class,
                    payload -> {
                        AtomicInteger left = failuresLeft.get(payload.value());
                        if (left != null && left.getAndDecrement() > 0) {
                            throw new IllegalStateException("provider unavailable");
                        }
                        delivered.add(payload.value());
                    },
                    (payload, reason) -> gaveUp.add(payload.value() + " | " + reason)));
        }
    }

    @TestConfiguration
    static class Config {
        @Bean
        TestHandler testHandler() {
            return new TestHandler();
        }
    }

    @MockitoBean
    private EmailService emailService;

    @Autowired
    private Outbox outbox;

    @Autowired
    private OutboxDispatcher dispatcher;

    @Autowired
    private OutboxPayloadCipher cipher;

    @Autowired
    private TestHandler handler;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @Autowired
    @Qualifier("emailTaskExecutor")
    private Executor emailTaskExecutor;

    // Each test starts from an empty table, so one test's still-pending row can't be delivered by
    // another test's poll.
    @BeforeEach
    void reset() {
        jdbc.update("DELETE FROM outbox");
        handler.failuresLeft.clear();
        handler.delivered.clear();
        handler.gaveUp.clear();
    }

    private String unique() {
        return "v-" + UUID.randomUUID();
    }

    private Map<String, Object> row(long id) {
        return jdbc.queryForMap("SELECT status, attempts, payload, last_error FROM outbox WHERE id = ?", id);
    }

    private void makeDue(long id) {
        jdbc.update("UPDATE outbox SET next_attempt_at = DATEADD(SECOND, -1, SYSUTCDATETIME()) WHERE id = ?", id);
    }

    // A row written straight into the table, the way it looks to a replica that did not write it:
    // nothing in this JVM is going to try it, so only a poll can.
    private long insertDirectly(String value) {
        return jdbc.queryForObject("INSERT INTO outbox (handler, payload) OUTPUT inserted.id VALUES (?, ?)",
                Long.class, TestHandler.NAME, cipher.encrypt("{\"value\":\"" + value + "\"}"));
    }

    @Test
    void aRowCommitsWithItsTransactionAndIsDeliveredAfterIt() throws Exception {
        String value = unique();
        long id = transactionTemplate.execute(status -> outbox.enqueue(TestHandler.NAME, new TestPayload(value)));
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);

        assertThat(handler.delivered).containsExactly(value);
        Map<String, Object> row = row(id);
        assertThat(row.get("status")).isEqualTo("SENT");
        assertThat(row.get("payload")).as("a completed row must not keep its payload").isNull();
    }

    @Test
    void aRowRollsBackWithItsTransactionAndIsNeverDelivered() throws Exception {
        String value = unique();
        assertThatThrownBy(() -> transactionTemplate.executeWithoutResult(status -> {
            outbox.enqueue(TestHandler.NAME, new TestPayload(value));
            throw new IllegalStateException("the business change failed");
        })).isInstanceOf(IllegalStateException.class);
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);

        assertThat(handler.delivered).doesNotContain(value);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM outbox", Integer.class)).isZero();
    }

    @Test
    void aPendingPayloadIsEncryptedAtRest() throws Exception {
        String secret = "code-" + unique();
        handler.failuresLeft.put(secret, new AtomicInteger(1));
        long id = outbox.enqueue(TestHandler.NAME, new TestPayload(secret));
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);

        String stored = (String) row(id).get("payload");
        assertThat(stored).isNotNull().doesNotContain(secret).doesNotContain("value");
        assertThat(cipher.decrypt(stored)).contains(secret);
    }

    @Test
    void aFailedAttemptIsRetriedAndARecoveredRowIsNeverReportedAsFailed() throws Exception {
        String value = unique();
        handler.failuresLeft.put(value, new AtomicInteger(1));
        long id = outbox.enqueue(TestHandler.NAME, new TestPayload(value));
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);

        Map<String, Object> afterFirst = row(id);
        assertThat(afterFirst.get("status")).isEqualTo("PENDING");
        assertThat(afterFirst.get("attempts")).isEqualTo(1);
        assertThat((String) afterFirst.get("last_error")).contains("provider unavailable");

        makeDue(id);
        dispatcher.pollDue();

        assertThat(row(id).get("status")).isEqualTo("SENT");
        assertThat(handler.delivered).containsExactly(value);
        assertThat(handler.gaveUp).isEmpty();
    }

    @Test
    void aRowThatKeepsFailingIsGivenUpOnOnceAndKept() throws Exception {
        String value = unique();
        handler.failuresLeft.put(value, new AtomicInteger(99));
        long id = outbox.enqueue(TestHandler.NAME, new TestPayload(value));
        EmailTestSupport.awaitEmailsIdle(emailTaskExecutor);

        makeDue(id);
        dispatcher.pollDue();
        assertThat(row(id).get("status")).isEqualTo("PENDING");
        makeDue(id);
        dispatcher.pollDue();

        Map<String, Object> failed = row(id);
        assertThat(failed.get("status")).isEqualTo("FAILED");
        assertThat(failed.get("attempts")).isEqualTo(3);
        assertThat(failed.get("payload")).isNull();
        assertThat(handler.gaveUp).singleElement().asString()
                .startsWith(value).contains("provider unavailable").contains("after 3 attempts");

        // Nothing deletes or re-delivers a FAILED row.
        makeDue(id);
        dispatcher.pollDue();
        dispatcher.purgeSent();
        assertThat(row(id).get("status")).isEqualTo("FAILED");
        assertThat(handler.gaveUp).hasSize(1);
    }

    @Test
    void aRowHeldByADeadReplicaIsPickedUpOnceItsLeaseExpires() {
        String value = unique();
        long id = insertDirectly(value);
        // Another replica claimed it and died mid-send.
        jdbc.update("UPDATE outbox SET claimed_until = DATEADD(MINUTE, 5, SYSUTCDATETIME()), attempts = 1 WHERE id = ?", id);

        dispatcher.pollDue();
        assertThat(handler.delivered).as("a live lease must not be taken").isEmpty();

        jdbc.update("UPDATE outbox SET claimed_until = DATEADD(SECOND, -1, SYSUTCDATETIME()) WHERE id = ?", id);
        dispatcher.pollDue();

        assertThat(handler.delivered).containsExactly(value);
        assertThat(row(id).get("status")).isEqualTo("SENT");
    }

    @Test
    void replicasPollingAtOnceDeliverEachRowExactlyOnce() throws Exception {
        List<String> values = new ArrayList<>();
        for (int i = 0; i < 40; i++) {
            String value = unique();
            values.add(value);
            insertDirectly(value);
        }

        int replicas = 4;
        ExecutorService pool = Executors.newFixedThreadPool(replicas);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<?>> polls = new ArrayList<>();
            for (int i = 0; i < replicas; i++) {
                polls.add(pool.submit(() -> {
                    start.await();
                    // Batch size 20, so it takes more than one round to drain 40.
                    for (int round = 0; round < 3; round++) {
                        dispatcher.pollDue();
                    }
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> poll : polls) {
                poll.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(handler.delivered).containsExactlyInAnyOrderElementsOf(values);
    }

    @Test
    void aRowNamingNoKnownHandlerFailsInsteadOfStickingAround() {
        long id = jdbc.queryForObject("INSERT INTO outbox (handler, payload) OUTPUT inserted.id VALUES (?, ?)",
                Long.class, "test.renamed-away", cipher.encrypt("{}"));

        dispatcher.pollDue();

        Map<String, Object> row = row(id);
        assertThat(row.get("status")).isEqualTo("FAILED");
        assertThat((String) row.get("last_error")).contains("test.renamed-away");
    }
}
