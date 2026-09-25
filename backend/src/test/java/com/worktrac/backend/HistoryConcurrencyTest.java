package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.HistoryDevice;
import com.worktrac.backend.support.HistoryWorkload;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// "Never stuck" under real contention. Several writers hammer one person's History while several
// devices sync as fast as they can, each applying whatever it gets (a 503 -- a write landed between
// the sync's steps -- is simply retried, as the app's query retry would). Every state any device
// passes through is recorded.
//
// Then the writers stop, and the claim is checked where it matters: ONE sync from EVERY recorded
// state must leave that state holding exactly GET /history. A reply that paired a month with a
// fingerprint describing some other state -- the thing the one-statement load and the kept-month
// re-check exist to prevent -- would leave a recorded state that a quiet sync cannot repair, because
// the server would call it unchanged. The unit races in HistorySyncServiceTest stage that by hand;
// this lets real transactions find it.
//
// READ_COMMITTED_SNAPSHOT is switched on for this class's database, because production runs with it
// (Azure SQL's default) and the one-statement load's consistency is exactly the guarantee it gives.
// The shared integration databases do not enable it.
@AutoConfigureMockMvc
class HistoryConcurrencyTest extends AbstractIntegrationTest {

    private static final int WRITERS = 3;
    private static final int DEVICES = 3;
    private static final int WRITES_PER_WRITER = Integer.getInteger("history.concurrency.writes", 120);

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HistoryConcurrencyTest.class);
        String adminUrl = "jdbc:sqlserver://" + SQL_SERVER.getHost() + ":" + SQL_SERVER.getMappedPort(1433)
                + ";database=master;encrypt=false;trustServerCertificate=true";
        try (Connection conn = DriverManager.getConnection(adminUrl, SQL_SERVER.getUsername(), SQL_SERVER.getPassword());
             Statement stmt = conn.createStatement()) {
            stmt.execute("ALTER DATABASE [it_historyconcurrencytest] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE");
        } catch (Exception e) {
            throw new IllegalStateException("Could not enable READ_COMMITTED_SNAPSHOT for the concurrency test", e);
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private SubscriptionRepository subscriptionRepository;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void everyStateADeviceReachesUnderConcurrentWritesConvergesInOneQuietSync() throws Exception {
        String email = "concurrency-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        String token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();
        long personId = registration.get("person").get("id").asLong();
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(SubscriptionStatus.ACTIVE);
        subscription.setPlan(BillingPlan.PLUS);
        subscriptionRepository.save(subscription);

        assertEquals(1, readCommittedSnapshotIsOn(), "this test is only meaningful under RCSI, as in production");

        long renamable = objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Custom Lift"))))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
        List<Long> exercises = new ArrayList<>();
        objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString()).forEach(e -> {
                    if (exercises.size() < 3 && e.get("isGlobal").asBoolean()) exercises.add(e.get("id").asLong());
                });

        AtomicBoolean writing = new AtomicBoolean(true);
        AtomicInteger unavailable = new AtomicInteger();
        AtomicInteger syncs = new AtomicInteger();
        AtomicInteger writerServerErrors = new AtomicInteger();
        ConcurrentLinkedQueue<HistoryDevice> reached = new ConcurrentLinkedQueue<>();
        List<String> problems = Collections.synchronizedList(new ArrayList<>());
        List<HistoryDevice> devices = new ArrayList<>();
        for (int i = 0; i < DEVICES; i++) devices.add(new HistoryDevice(objectMapper));

        ExecutorService pool = Executors.newFixedThreadPool(WRITERS + DEVICES);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> writers = new ArrayList<>();
        for (int w = 0; w < WRITERS; w++) {
            long seed = 1000 + w;
            writers.add(pool.submit(() -> {
                // No clock and no plan lever: those are account-wide, and concurrent writers share them.
                HistoryWorkload workload = new HistoryWorkload(mockMvc, objectMapper, token, personId, null,
                        exercises, renamable, null, null, seed);
                start.await();
                for (int i = 0; i < WRITES_PER_WRITER; i++) workload.step();
                writerServerErrors.addAndGet(workload.serverErrors());
                return null;
            }));
        }
        List<Future<?>> syncers = new ArrayList<>();
        for (HistoryDevice device : devices) {
            syncers.add(pool.submit(() -> {
                start.await();
                while (writing.get()) {
                    MvcResult result = sync(token, personId, device);
                    int status = result.getResponse().getStatus();
                    syncs.incrementAndGet();
                    if (status == 503) {
                        unavailable.incrementAndGet();
                        continue;
                    }
                    if (status != 200) {
                        problems.add("sync answered " + status + ": " + result.getResponse().getContentAsString());
                        continue;
                    }
                    try {
                        device.apply(objectMapper.readTree(result.getResponse().getContentAsString()));
                    } catch (AssertionError e) {
                        problems.add(e.getMessage());
                    }
                    reached.add(device.copy());
                }
                return null;
            }));
        }

        start.countDown();
        for (Future<?> writer : writers) writer.get(10, TimeUnit.MINUTES);
        writing.set(false);
        for (Future<?> syncer : syncers) syncer.get(2, TimeUnit.MINUTES);
        pool.shutdown();

        assertTrue(problems.isEmpty(), "sync failures while writes were landing:\n" + String.join("\n", problems));
        assertTrue(reached.size() >= 20, "too few syncs landed to mean anything: " + reached.size());

        // Quiet now. From every state any device reached, one sync must converge.
        JsonNode truth = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personId + "/history")
                .header("Authorization", "Bearer " + token)).andReturn().getResponse().getContentAsString());
        assertTrue(truth.size() > 0, "the writers produced no History at all");
        int checked = 0;
        List<HistoryDevice> states = new ArrayList<>(reached);
        states.addAll(devices);
        for (HistoryDevice state : states) {
            MvcResult result = sync(token, personId, state);
            if (result.getResponse().getStatus() != 200) {
                fail("a quiet sync answered " + result.getResponse().getStatus());
            }
            state.apply(objectMapper.readTree(result.getResponse().getContentAsString()));
            if (!truth.equals(state.flatten())) {
                fail("state " + checked + " of " + states.size() + " did not converge in one quiet sync -- it is stuck.\n"
                        + "  device: " + state.flatten() + "\n  truth:  " + truth);
            }
            checked++;
        }
        System.out.println("HistoryConcurrencyTest: " + WRITERS + " writers x " + WRITES_PER_WRITER + " writes, "
                + syncs.get() + " concurrent syncs (" + unavailable.get() + " answered 503), "
                + writerServerErrors.get() + " writes answered 5xx under contention, "
                + checked + " reached states all converged in one quiet sync");
    }

    private MvcResult sync(String token, long personId, HistoryDevice device) throws Exception {
        return mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("have", device.have()))))
                .andReturn();
    }

    private int readCommittedSnapshotIsOn() throws Exception {
        String adminUrl = "jdbc:sqlserver://" + SQL_SERVER.getHost() + ":" + SQL_SERVER.getMappedPort(1433)
                + ";database=master;encrypt=false;trustServerCertificate=true";
        try (Connection conn = DriverManager.getConnection(adminUrl, SQL_SERVER.getUsername(), SQL_SERVER.getPassword());
             Statement stmt = conn.createStatement();
             var rs = stmt.executeQuery("SELECT CAST(is_read_committed_snapshot_on AS INT) FROM sys.databases WHERE name = 'it_historyconcurrencytest'")) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
