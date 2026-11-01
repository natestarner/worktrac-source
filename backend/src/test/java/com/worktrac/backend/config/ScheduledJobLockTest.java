package com.worktrac.backend.config;

import com.worktrac.backend.billing.SubscriptionReconciliationWatchdog;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationDispatchWatchdog;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// Each @Scheduled job must run on ONE replica per interval (SchedulingConfig). Two replicas share
// nothing but the database, and the lock is a row in it -- so calling the same bean from two threads,
// or twice inside one interval, exercises exactly the path a second replica would take: ShedLock's
// UPDATE ... WHERE lock_until <= <db now> finds the row still held and the call is skipped.
//
// The watchdog cases are written against an observable side effect (the DISPATCH_MISSING audit row),
// not the shedlock table, so they fail on code without the lock: there, the second run re-flags.
class ScheduledJobLockTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ScheduledJobLockTest.class);
    }

    // Required by every integration test: EmailService builds a live ACS client in its constructor.
    @MockitoBean
    private EmailService emailService;

    @Autowired
    private RegistrationDispatchWatchdog dispatchWatchdog;

    @Autowired
    private SubscriptionReconciliationWatchdog reconciliationWatchdog;

    @Autowired
    private RegistrationEventRepository events;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private Clock clock;

    // EXPIRE the locks, never delete them: ShedLock remembers which rows it has already inserted and
    // only UPDATEs those afterwards, so a deleted row makes every later call silently skip.
    @BeforeEach
    void releaseLocks() {
        jdbc.update("UPDATE shedlock SET lock_until = DATEADD(MINUTE, -1, SYSUTCDATETIME())");
    }

    private String stuckRegistration() {
        String email = "stuck-" + UUID.randomUUID() + "@example.com";
        // Past RegistrationDispatchWatchdog's grace period (15 min) and inside its lookback (60 min).
        Instant startedAt = clock.instant().minus(Duration.ofMinutes(20));
        events.save(new RegistrationEvent(email, RegistrationEventType.REGISTER_STARTED, null, null, null, startedAt));
        return email;
    }

    private long missingFlags(String email) {
        return events.findAll().stream()
                .filter(e -> e.getEmail().equals(email))
                .filter(e -> e.getEventType() == RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING)
                .count();
    }

    @Test
    void aSecondRunInsideTheSameIntervalIsSkipped() {
        String email = stuckRegistration();

        dispatchWatchdog.checkForMissingDispatch();
        assertEquals(1, missingFlags(email), "the first run should flag the stuck registration");

        // Remove the flag, so that a run which actually executes would write it again.
        events.findAll().stream()
                .filter(e -> e.getEmail().equals(email))
                .filter(e -> e.getEventType() == RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING)
                .forEach(events::delete);

        dispatchWatchdog.checkForMissingDispatch();
        assertEquals(0, missingFlags(email),
                "a second run within lockAtLeastFor must be skipped -- it is what another replica's timer does");
    }

    @Test
    void concurrentRunsFlagAStuckRegistrationExactlyOnce() throws Exception {
        String email = stuckRegistration();

        int replicas = 4;
        ExecutorService pool = Executors.newFixedThreadPool(replicas);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<?>> runs = new java.util.ArrayList<>();
            for (int i = 0; i < replicas; i++) {
                runs.add(pool.submit(() -> {
                    start.await();
                    dispatchWatchdog.checkForMissingDispatch();
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> run : runs) {
                run.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        assertEquals(1, missingFlags(email), "only the replica holding the lock may run the sweep");
    }

    @Test
    void bothJobsHoldTheirLockForAlmostTheirWholeInterval() {
        dispatchWatchdog.checkForMissingDispatch();
        reconciliationWatchdog.reconcileLapsedSubscriptions();

        assertHeldFor("registrationDispatchWatchdog", Duration.ofMinutes(4));
        assertHeldFor("subscriptionReconciliationWatchdog", Duration.ofMinutes(55));
    }

    private void assertHeldFor(String name, Duration expected) {
        Timestamp[] row = jdbc.queryForObject(
                "SELECT locked_at, lock_until FROM shedlock WHERE name = ?",
                (rs, n) -> new Timestamp[] {rs.getTimestamp("locked_at"), rs.getTimestamp("lock_until")},
                name);
        Duration held = Duration.between(row[0].toInstant(), row[1].toInstant());
        // lock_until is set to locked_at + lockAtLeastFor once the job finishes; allow for the job's
        // own run time between the two.
        assertTrue(held.compareTo(expected) >= 0 && held.compareTo(expected.plusMinutes(1)) < 0,
                name + " should be held for ~" + expected + " but was held for " + held);
    }
}
