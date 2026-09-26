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
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.stream.LongStream;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// The property History sync exists to guarantee, tested directly rather than case by case:
//
//     however far behind a device is, ONE sync leaves it holding exactly GET /history.
//
// If that holds from every state a device can be in, History can lag (offline, between syncs) but can
// never be stuck, out of sync or wrong. HistoryFingerprintTest checks the fingerprint moves for each
// action I thought of; this runs long random sequences of every write -- including the account-wide
// levers (plan changes, the clock aging workouts out of the Free window) and a sibling's writes --
// and after each one lets several devices at very different staleness sync, and compares.
//
//   every     -- syncs after every write
//   lagging   -- syncs every 3-20 writes, so its `have` is several changes old
//   rarely    -- syncs every ~40 writes
//   restored  -- sometimes rolls back to a snapshot from earlier in the run first, as a reload
//                restoring an out-of-date persisted cache does
//   fresh     -- sometimes forgets everything first: a new device, or a cache from before the sync
//   scoped    -- the device the writes are made ON: after each of its own writes it runs the SCOPED
//                sync the app runs (only the touched workout's months), and every 5-15 writes an
//                ordinary one. A scoped sync must leave every month it covered exactly right; the
//                ordinary sync that follows must then leave EVERYTHING right -- so nothing a scoped
//                sync skipped can be stuck, however the writes elsewhere moved things around.
//
// Reproducible: a failure names its seed and step. Run longer or replay one seed with
//   -Dhistory.convergence.steps=5000  -Dhistory.convergence.seed=<seed>
@AutoConfigureMockMvc
class HistoryConvergenceTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HistoryConvergenceTest.class);
    }

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private MutableClock clock;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private SubscriptionRepository subscriptionRepository;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    static Stream<Long> seeds() {
        String replay = System.getProperty("history.convergence.seed");
        if (replay != null) return Stream.of(Long.parseLong(replay));
        return LongStream.of(1L, 42L, 20260925L, 7_777_777L).boxed();
    }

    @ParameterizedTest(name = "seed {0}")
    @MethodSource("seeds")
    void oneSyncFromAnyStateConvergesToHistory(long seed) throws Exception {
        int steps = Integer.getInteger("history.convergence.steps", 150);
        clock.advance(Duration.between(clock.instant(), Instant.parse("2026-06-15T12:00:00Z")));

        String email = "converge-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        String token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();
        long personId = registration.get("person").get("id").asLong();
        setFullHistory(accountId, true);
        long siblingId = createPerson(token, "Sam");
        long renamable = createExercise(token, "Custom Lift");
        List<Long> exercises = new ArrayList<>();
        objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString()).forEach(e -> {
                    if (exercises.size() < 3 && e.get("isGlobal").asBoolean()) exercises.add(e.get("id").asLong());
                });

        HistoryWorkload workload = new HistoryWorkload(mockMvc, objectMapper, token, personId, siblingId, exercises,
                renamable, clock, full -> setFullHistory(accountId, full), seed);
        Random random = new Random(seed ^ 0x5EED);

        HistoryDevice every = new HistoryDevice(objectMapper);
        HistoryDevice lagging = new HistoryDevice(objectMapper);
        HistoryDevice rarely = new HistoryDevice(objectMapper);
        HistoryDevice restored = new HistoryDevice(objectMapper);
        HistoryDevice fresh = new HistoryDevice(objectMapper);
        HistoryDevice scoped = new HistoryDevice(objectMapper);
        Random scopedRandom = new Random(seed ^ 0x5C0BEDL);
        int scopedFullNext = 1;
        int scopedSyncs = 0;
        List<HistoryDevice> snapshots = new ArrayList<>();
        int laggingNext = 3;
        int rarelyNext = 40;

        List<String> trail = new ArrayList<>();
        for (int step = 1; step <= steps; step++) {
            trail.add(step + ": " + workload.step());
            if (workload.serverErrors() > 0) {
                fail("seed " + seed + " step " + step + ": a write answered 5xx single-threaded\n" + tail(trail));
            }
            JsonNode truth = history(token, personId);

            syncAndCompare("every", every, truth, token, personId, seed, step, trail);

            if (step >= laggingNext) {
                syncAndCompare("lagging", lagging, truth, token, personId, seed, step, trail);
                laggingNext = step + 3 + random.nextInt(18);
            }
            if (step >= rarelyNext) {
                syncAndCompare("rarely", rarely, truth, token, personId, seed, step, trail);
                rarelyNext = step + 30 + random.nextInt(20);
            }
            if (random.nextInt(4) == 0) {
                if (!snapshots.isEmpty() && random.nextInt(3) == 0) {
                    restored.restoreFrom(snapshots.get(random.nextInt(snapshots.size())));
                }
                syncAndCompare("restored", restored, truth, token, personId, seed, step, trail);
            }
            if (random.nextInt(10) == 0) {
                if (random.nextBoolean()) fresh.forget();
                syncAndCompare("fresh", fresh, truth, token, personId, seed, step, trail);
            }
            if (random.nextInt(5) == 0) snapshots.add(every.copy());

            Long touched = workload.touchedSession();
            if (touched != null && scoped.monthCount() > 0) {
                scopedSyncAndCompare(scoped, touched, workload.touchedStartedAt(), truth, token, personId, seed, step, trail);
                scopedSyncs++;
            }
            if (step >= scopedFullNext) {
                syncAndCompare("scoped (ordinary sync)", scoped, truth, token, personId, seed, step, trail);
                scopedFullNext = step + 5 + scopedRandom.nextInt(11);
            }
        }
        // Not vacuous: a run that passed on a stream of refused writes would prove nothing. Every kind of
        // write must have been accepted at least once, and the device must end up holding something.
        StringBuilder tally = new StringBuilder("seed " + seed + " (" + steps + " writes), accepted/refused:");
        workload.outcomes().forEach((action, counts) -> tally.append("\n  ").append(action)
                .append(": ").append(counts[0]).append('/').append(counts[1]));
        System.out.println(tally);
        if (steps >= 100) {
            for (String action : List.of("live set", "past workout", "set into workout", "edit set", "delete set",
                    "note", "move workout", "rename exercise", "import", "undo import", "sibling's set")) {
                int[] counts = workload.outcomes().get(action);
                if (counts == null || counts[0] == 0) fail("seed " + seed + ": never succeeded at '" + action + "'\n" + tally);
            }
        }
        assertEquals(true, every.monthCount() > 0, "seed " + seed + ": the run ended holding no months at all");
        if (steps >= 100 && scopedSyncs < 20) {
            fail("seed " + seed + ": only " + scopedSyncs + " scoped syncs ran -- the scoped path went untested");
        }
    }

    // The sync the app runs after its own write: scoped to the workout it touched, with the start time
    // the device HOLDS for it plus the one the write's response gave (either may be absent). Every month
    // the reply covers must then be exactly what GET /history shows for that month.
    private void scopedSyncAndCompare(HistoryDevice device, long session, String startedAtFromWrite, JsonNode truth,
                                      String token, long personId, long seed, int step, List<String> trail) throws Exception {
        List<String> at = new ArrayList<>();
        String held = device.startedAtOf(session);
        if (held != null) at.add(held);
        if (startedAtFromWrite != null) at.add(startedAtFromWrite);
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("have", device.have());
        body.put("sessions", List.of(session));
        body.put("at", at);
        MvcResult result = mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andReturn();
        String where = "seed " + seed + ", step " + step + ", device 'scoped' (workout " + session + ", at " + at + ")";
        if (result.getResponse().getStatus() != 200) {
            fail(where + ": scoped sync answered " + result.getResponse().getStatus() + "\n" + tail(trail));
        }
        JsonNode reply = objectMapper.readTree(result.getResponse().getContentAsString());
        if (reply.get("scope") == null || !reply.get("scope").isArray() || reply.get("scope").isEmpty()) {
            fail(where + ": a scoped request got an unscoped reply: " + reply);
        }
        try {
            device.apply(reply);
        } catch (AssertionError e) {
            fail(where + ": " + e.getMessage() + "\n" + tail(trail));
        }
        // The workout this device just wrote to must be ON the device afterwards, wherever it now is --
        // the one thing a scoped sync may never get wrong, since it is what the person is looking at.
        // (It covers the case the per-month check below cannot: a workout moved to another month
        // elsewhere, which would leave its old month correctly empty and the workout nowhere.)
        for (JsonNode sessionNode : truth) {
            if (sessionNode.get("id").asLong() == session && device.startedAtOf(session) == null) {
                fail(where + ": the workout just written to is missing from the device after its scoped sync\\n"
                        + tail(trail));
            }
        }
        for (JsonNode month : reply.get("scope")) {
            com.fasterxml.jackson.databind.node.ArrayNode expected = objectMapper.createArrayNode();
            truth.forEach(sessionNode -> {
                if (sessionNode.get("startedAt").asText().startsWith(month.asText())) expected.add(sessionNode);
            });
            if (!expected.equals(device.sessionsIn(month.asText()))) {
                fail(where + ": after a scoped sync the device's " + month.asText() + " is not GET /history's\n"
                        + "  device: " + device.sessionsIn(month.asText()) + "\n  truth:  " + expected + "\n" + tail(trail));
            }
        }
    }

    private void syncAndCompare(String name, HistoryDevice device, JsonNode truth, String token, long personId,
                                long seed, int step, List<String> trail) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("have", device.have()))))
                .andReturn();
        String where = "seed " + seed + ", step " + step + ", device '" + name + "'";
        if (result.getResponse().getStatus() != 200) {
            fail(where + ": sync answered " + result.getResponse().getStatus() + " with no concurrent writer\n" + tail(trail));
        }
        try {
            device.apply(objectMapper.readTree(result.getResponse().getContentAsString()));
        } catch (AssertionError e) {
            fail(where + ": " + e.getMessage() + "\n" + tail(trail));
        }
        if (!truth.equals(device.flatten())) {
            fail(where + ": after one sync the device does not hold GET /history\n"
                    + "  device: " + device.flatten() + "\n  truth:  " + truth + "\n" + tail(trail));
        }
    }

    private static String tail(List<String> trail) {
        return "last writes:\n  " + String.join("\n  ", trail.subList(Math.max(0, trail.size() - 12), trail.size()));
    }

    private JsonNode history(String token, long personId) throws Exception {
        return objectMapper.readTree(mockMvc.perform(get("/api/people/" + personId + "/history")
                .header("Authorization", "Bearer " + token)).andReturn().getResponse().getContentAsString());
    }

    private void setFullHistory(long accountId, boolean full) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(full ? SubscriptionStatus.ACTIVE : SubscriptionStatus.FREE);
        subscription.setPlan(full ? BillingPlan.PLUS : BillingPlan.FREE);
        subscriptionRepository.save(subscription);
    }

    private long createPerson(String token, String name) throws Exception {
        return objectMapper.readTree(mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name))))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
    }

    private long createExercise(String token, String name) throws Exception {
        return objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name))))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
    }
}
