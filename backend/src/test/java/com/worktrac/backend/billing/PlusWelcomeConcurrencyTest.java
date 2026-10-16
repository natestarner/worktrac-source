package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.EventListener;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

// "The welcome-to-Plus email fires exactly once, ever" (billing.md) -- under CONCURRENCY, which is
// the normal case rather than an edge one. A real checkout lands checkout.session.completed,
// customer.subscription.created and invoice.paid within the same second, and the browser's return
// reconciles alongside them, so four transactions run applyStripeState for one household at once.
// Every one read plus_welcome_sent_at as null before any of them committed, and a sandbox checkout
// sent the welcome three times.
//
// Each writer here loads the row and then waits at a barrier, so ALL of them have read the
// pre-upgrade state before ANY of them writes -- the window real webhooks hit by timing, forced
// rather than hoped for. READ_COMMITTED_SNAPSHOT is on because production runs with it, and it is
// exactly the setting under which a read-then-check cannot see another writer's uncommitted claim.
class PlusWelcomeConcurrencyTest extends AbstractIntegrationTest {

    private static final int WRITERS = 4;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, PlusWelcomeConcurrencyTest.class);
        String adminUrl = "jdbc:sqlserver://" + SQL_SERVER.getHost() + ":" + SQL_SERVER.getMappedPort(1433)
                + ";database=master;encrypt=false;trustServerCertificate=true";
        try (Connection conn = DriverManager.getConnection(adminUrl, SQL_SERVER.getUsername(), SQL_SERVER.getPassword());
             Statement stmt = conn.createStatement()) {
            stmt.execute("ALTER DATABASE [it_pluswelcomeconcurrencytest] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE");
        } catch (Exception e) {
            throw new IllegalStateException("Could not enable READ_COMMITTED_SNAPSHOT for the concurrency test", e);
        }
    }

    // Counts publications as they happen, on whichever thread publishes. @RecordApplicationEvents
    // cannot be used: it only sees events published on the test's own thread.
    @TestConfiguration
    static class CountUpgrades {
        static final AtomicInteger published = new AtomicInteger();

        @Bean
        Object plusUpgradedCounter() {
            return new Object() {
                @EventListener
                public void on(PlusUpgradedEvent event) {
                    published.incrementAndGet();
                }
            };
        }
    }

    @Autowired private SubscriptionService subscriptionService;
    @Autowired private SubscriptionRepository subscriptionRepository;
    @Autowired private AccountRepository accountRepository;
    @Autowired private TransactionTemplate transactionTemplate;

    @MockitoBean private EmailService emailService;

    @Test
    void concurrentFirstUpgradesPublishTheWelcomeExactlyOnce() throws Exception {
        Account account = accountRepository.save(new Account("Household " + UUID.randomUUID().toString().substring(0, 8)));
        subscriptionService.getOrCreate(account);
        Long accountId = account.getId();
        StripeSubscriptionState active = new StripeSubscriptionState("cus_1", "sub_1", "price_1",
                SubscriptionStatus.ACTIVE, BillingInterval.MONTH, Instant.now().plusSeconds(30L * 86400), false);
        CountUpgrades.published.set(0);

        CyclicBarrier allHaveRead = new CyclicBarrier(WRITERS);
        ExecutorService pool = Executors.newFixedThreadPool(WRITERS);
        try {
            List<Future<?>> writers = new ArrayList<>();
            for (int i = 0; i < WRITERS; i++) {
                writers.add(pool.submit(() -> transactionTemplate.executeWithoutResult(tx -> {
                    Subscription row = subscriptionRepository.findByAccountId(accountId).orElseThrow();
                    try {
                        allHaveRead.await(30, TimeUnit.SECONDS);
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                    subscriptionService.applyStripeState(row, active);
                })));
            }
            for (Future<?> writer : writers) {
                writer.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(CountUpgrades.published.get()).isEqualTo(1);
        // Written by the claim's native UPDATE, read back through the entity mapping: the two must
        // agree on time zone, or "sent at" would be hours off.
        assertThat(subscriptionRepository.findByAccountId(accountId).orElseThrow().getPlusWelcomeSentAt())
                .isCloseTo(Instant.now(), within(1, ChronoUnit.MINUTES));
    }
}
