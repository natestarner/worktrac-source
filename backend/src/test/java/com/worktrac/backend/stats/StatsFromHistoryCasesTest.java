package com.worktrac.backend.stats;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.HistoryWorkload;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.support.StatsWorkload;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.Test;
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

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

// The equivalence oracle for deriving the PRs board and Trends on the device
// (docs/architecture/prs-trends-from-history.md): History in, StatsService's answers out.
//
// Random, reproducible sequences of real writes (StatsWorkload: everything HistoryConvergenceTest
// drives, plus bodyweight, holds, kg, ties and week-edge workouts) are snapshotted along the way.
// Each snapshot holds exactly what a device has -- GET /history (what a converged device holds; see
// HistoryConvergenceTest) and the History window -- beside every answer the server gives for it:
// /prs, the overview at three ranges, and each exercise's records and trend at two. The frontend
// suite folds each snapshot's History and must produce the same answers (statsFromHistory.test.js).
//
// The snapshots are checked in, the way shared/record-rules pins Epley and session volume across
// both languages: this test FAILS when StatsService's answers change and the file was not
// regenerated, so a server-side change can never silently leave the device's fold behind.
//
//   Regenerate:  mvn test -Dtest=StatsFromHistoryCasesTest -Dstats.cases.write=true
//   then:        cd frontend && npx vitest run src/utils/statsFromHistory.test.js
//
// Ids are renumbered in order of first appearance, so a migration that seeds another exercise does
// not rewrite the file.
@AutoConfigureMockMvc
class StatsFromHistoryCasesTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, StatsFromHistoryCasesTest.class);
    }

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    static final Path CASES = Path.of("..", "shared", "record-rules", "stats-from-history-cases.json");
    private static final long[] SEEDS = {1L, 42L, 20260928L};
    private static final int STEPS = 160;
    private static final int SNAPSHOT_EVERY = 40;
    // A different viewer's zone per snapshot: the week edges and "today" move with it.
    private static final List<String> ZONES = List.of("America/New_York", "Pacific/Auckland", "UTC", "America/Los_Angeles");
    private static final int[] OVERVIEW_WEEKS = {4, 12, 260};
    private static final int[] TREND_WEEKS = {12, 260};

    @Autowired private MockMvc mockMvc;
    @Autowired private MutableClock clock;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private SubscriptionRepository subscriptionRepository;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final JsonNodeFactory nodes = JsonNodeFactory.instance;

    @Test
    void theCheckedInCasesAreWhatTheServerAnswersToday() throws Exception {
        ArrayNode cases = nodes.arrayNode();
        int zone = 0;
        for (long seed : SEEDS) {
            Household h = household(seed);
            for (int step = 1; step <= STEPS; step++) {
                h.workload.step();
                if (step % SNAPSHOT_EVERY == 0) {
                    cases.add(snapshot("seed " + seed + ", step " + step, h, ZONES.get(zone++ % ZONES.size())));
                }
            }
        }
        assertCovered(cases);

        String generated = render(cases);
        if (Boolean.getBoolean("stats.cases.write")) {
            Files.writeString(CASES, generated, StandardCharsets.UTF_8);
            return;
        }
        String checkedIn = Files.exists(CASES) ? Files.readString(CASES, StandardCharsets.UTF_8) : "";
        if (!generated.equals(checkedIn)) {
            fail(firstDifference(generated, checkedIn) + "\n\nStatsService's answers no longer match "
                    + CASES.normalize() + ". If the change is intended, regenerate with\n"
                    + "  mvn test -Dtest=StatsFromHistoryCasesTest -Dstats.cases.write=true\n"
                    + "and make the device's fold agree (statsFromHistory.test.js) in the same change.");
        }
    }

    // ── one household ───────────────────────────────────────────────────────────────────────────

    private record Household(String token, long personId, long accountId, StatsWorkload workload) {}

    private Household household(long seed) throws Exception {
        clock.advance(Duration.between(clock.instant(), Instant.parse("2026-06-15T12:00:00Z")));
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                "stats-cases-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com", "Nate");
        String token = registration.get("token").asText();
        long accountId = registration.get("account").get("id").asLong();
        long personId = registration.get("person").get("id").asLong();
        setPlus(accountId, true);
        long siblingId = objectMapper.readTree(request(post("/api/people"), token, Map.of("name", "Sam"))).get("id").asLong();
        long custom = objectMapper.readTree(request(post("/api/exercises"), token, Map.of("name", "Custom Lift"))).get("id").asLong();
        long hold = objectMapper.readTree(request(post("/api/exercises"), token,
                Map.of("name", "Probe Hold", "trackingType", "duration"))).get("id").asLong();

        List<Long> strength = new ArrayList<>();
        List<String> strengthNames = new ArrayList<>();
        long pullUp = -1;
        for (JsonNode e : objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString())) {
            if (!e.get("isGlobal").asBoolean() || !"strength".equals(e.get("trackingType").asText())) continue;
            String name = e.get("name").asText();
            if (name.equals("Pull-up")) pullUp = e.get("id").asLong();
            else if (strength.size() < 3 && (name.contains("Bench") || name.contains("Squat") || name.contains("Row"))) {
                strength.add(e.get("id").asLong());
                strengthNames.add(name);
            }
        }
        assertTrue(pullUp > 0 && strength.size() == 3, "expected Pull-up and three barbell lifts in the seeded catalog");

        HistoryWorkload history = new HistoryWorkload(mockMvc, objectMapper, token, personId, siblingId, strength,
                custom, clock, full -> setPlus(accountId, full), seed);
        StatsWorkload workload = new StatsWorkload(history, mockMvc, objectMapper, token, personId, pullUp, hold,
                "Probe Hold", strengthNames, clock, seed);
        return new Household(token, personId, accountId, workload);
    }

    // ── one snapshot: what the device holds, and what the server says about it ─────────────────

    private ObjectNode snapshot(String name, Household h, String zone) throws Exception {
        String p = "/api/people/" + h.personId();
        boolean plus = subscriptionRepository.findByAccountId(h.accountId()).orElseThrow().getPlan() != BillingPlan.FREE;

        JsonNode history = read(p + "/history", h.token(), Map.of());
        ObjectNode expected = nodes.objectNode();
        JsonNode prs = read(p + "/prs", h.token(), Map.of());
        expected.set("prs", prs);
        ObjectNode overview = expected.putObject("overview");
        for (int weeks : OVERVIEW_WEEKS) {
            overview.set(String.valueOf(weeks), read(p + "/trends/overview", h.token(), Map.of("weeks", String.valueOf(weeks), "zone", zone)));
        }
        // Every exercise with a set in view -- the PRs board's rows are exactly those.
        ObjectNode exercises = expected.putObject("exercises");
        for (JsonNode row : prs) {
            long exerciseId = row.get("exerciseId").asLong();
            ObjectNode one = exercises.putObject(String.valueOf(exerciseId));
            one.set("records", read(p + "/exercises/" + exerciseId + "/records", h.token(), Map.of("zone", zone)));
            ObjectNode trend = one.putObject("trend");
            for (int weeks : TREND_WEEKS) {
                trend.set(String.valueOf(weeks), read(p + "/trends/exercises/" + exerciseId, h.token(),
                        Map.of("weeks", String.valueOf(weeks), "zone", zone)));
            }
        }

        ObjectNode snapshot = nodes.objectNode();
        snapshot.put("name", name);
        snapshot.put("now", clock.instant().toString());
        snapshot.put("zone", zone);
        snapshot.put("plan", plus ? "PLUS" : "FREE");
        snapshot.set("historyWindow", read(p + "/history-window", h.token(), Map.of()));
        snapshot.set("history", history);
        snapshot.set("expected", expected);
        return renumber(snapshot);
    }

    // Exercise and workout ids, renumbered in order of first appearance (History first, then the
    // server's answers), everywhere they occur -- including the keys of `expected.exercises`.
    private ObjectNode renumber(ObjectNode snapshot) {
        Map<Long, Long> exercises = new HashMap<>();
        Map<Long, Long> sessions = new HashMap<>();
        for (JsonNode session : snapshot.get("history")) {
            sessions.computeIfAbsent(session.get("id").asLong(), k -> (long) sessions.size() + 1);
            for (JsonNode entry : session.get("entries")) {
                exercises.computeIfAbsent(entry.get("exerciseId").asLong(), k -> (long) exercises.size() + 1);
            }
        }
        for (JsonNode session : snapshot.get("history")) ((ObjectNode) session).put("id", sessions.get(session.get("id").asLong()));
        rewrite(snapshot, exercises, sessions);
        ObjectNode byExercise = (ObjectNode) snapshot.get("expected").get("exercises");
        ObjectNode renumbered = nodes.objectNode();
        new TreeSet<>(iterable(byExercise.fieldNames())).forEach(key -> renumbered.set(
                String.valueOf(exercises.computeIfAbsent(Long.parseLong(key), k -> (long) exercises.size() + 1)), byExercise.get(key)));
        ((ObjectNode) snapshot.get("expected")).set("exercises", renumbered);
        return snapshot;
    }

    private void rewrite(JsonNode node, Map<Long, Long> exercises, Map<Long, Long> sessions) {
        if (node instanceof ObjectNode object) {
            for (String field : new ArrayList<>(iterable(object.fieldNames()))) {
                JsonNode value = object.get(field);
                if (field.equals("exerciseId") && value.isNumber()) {
                    object.put(field, exercises.computeIfAbsent(value.asLong(), k -> (long) exercises.size() + 1));
                } else if (field.equals("sessionId") && value.isNumber()) {
                    object.put(field, sessions.computeIfAbsent(value.asLong(), k -> (long) sessions.size() + 1));
                } else {
                    rewrite(value, exercises, sessions);
                }
            }
        } else if (node instanceof ArrayNode array) {
            array.forEach(child -> rewrite(child, exercises, sessions));
        }
    }

    // ── non-vacuous: the cases must actually contain what makes this fold hard ───────────────────

    private void assertCovered(ArrayNode cases) {
        Set<String> seen = new HashSet<>();
        for (JsonNode c : cases) {
            if (c.get("plan").asText().equals("FREE") && c.get("historyWindow").get("hiddenSessions").asInt() > 0) seen.add("a Free snapshot with History behind the window");
            ZoneId zone = ZoneId.of(c.get("zone").asText());
            Map<String, Integer> repeats = new HashMap<>();
            for (JsonNode session : c.get("history")) {
                Instant startedAt = Instant.parse(session.get("startedAt").asText());
                if (!LocalDate.ofInstant(startedAt, zone).equals(LocalDate.ofInstant(startedAt, ZoneOffset.UTC))) seen.add("a workout on a different day in the viewer's zone than in UTC");
                for (JsonNode entry : session.get("entries")) {
                    for (JsonNode set : entry.get("sets")) {
                        if ("kg".equals(set.get("unit").asText())) seen.add("a kg set");
                        if (repeats.merge(entry.get("exerciseId") + "|" + set.get("weight") + "|" + set.get("reps") + "|" + set.get("durationSeconds") + "|" + set.get("unit"), 1, Integer::sum) == 2) seen.add("the same set twice (a tie)");
                    }
                }
            }
            // The zone must have reached the server: some answer is dated in the viewer's zone rather
            // than UTC. (The first generation passed every other check with the zone silently
            // falling back to UTC.)
            Map<Long, Instant> startedAt = new HashMap<>();
            c.get("history").forEach(s -> startedAt.put(s.get("id").asLong(), Instant.parse(s.get("startedAt").asText())));
            for (JsonNode exercise : c.get("expected").get("exercises")) {
                for (JsonNode points : exercise.get("trend")) {
                    for (JsonNode point : points) {
                        Instant at = startedAt.get(point.get("sessionId").asLong());
                        if (at != null && !point.get("date").asText().equals(LocalDate.ofInstant(at, ZoneOffset.UTC).toString())) {
                            seen.add("a server answer dated in the viewer's zone, not UTC");
                        }
                    }
                }
            }
            for (JsonNode row : c.get("expected").get("prs")) {
                if (row.get("bodyweightOnly").asBoolean()) seen.add("a bodyweight-only exercise");
                if (row.get("durationTracked").asBoolean()) seen.add("a hold");
                if (row.get("durationTracked").asBoolean() && row.get("best").get("weight").asDouble() > 0) seen.add("a hold with added load");
            }
        }
        List<String> required = List.of("a Free snapshot with History behind the window",
                "a workout on a different day in the viewer's zone than in UTC",
                "a server answer dated in the viewer's zone, not UTC", "a kg set", "the same set twice (a tie)",
                "a bodyweight-only exercise", "a hold", "a hold with added load");
        List<String> missing = required.stream().filter(r -> !seen.contains(r)).toList();
        assertEquals(List.of(), missing, "the generated cases never contain these, so they would prove nothing about them");
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────────────

    // One snapshot per line, so a regenerated file diffs by snapshot rather than as one giant line.
    private String render(ArrayNode cases) throws Exception {
        StringBuilder out = new StringBuilder("{\"generatedBy\":\"backend StatsFromHistoryCasesTest -- do not edit by hand\",\"cases\":[\n");
        for (int i = 0; i < cases.size(); i++) {
            out.append(objectMapper.writeValueAsString(cases.get(i))).append(i + 1 < cases.size() ? ",\n" : "\n");
        }
        return out.append("]}\n").toString();
    }

    private static String firstDifference(String generated, String checkedIn) {
        String[] a = generated.split("\n");
        String[] b = checkedIn.split("\n");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            String x = i < a.length ? a[i] : "<nothing>";
            String y = i < b.length ? b[i] : "<nothing>";
            if (!x.equals(y)) {
                int at = 0;
                while (at < Math.min(x.length(), y.length()) && x.charAt(at) == y.charAt(at)) at++;
                int from = Math.max(0, at - 120);
                return "First difference at line " + (i + 1) + ", column " + at + ":\n  server now: ..."
                        + x.substring(from, Math.min(x.length(), at + 120)) + "\n  checked in: ..."
                        + y.substring(Math.min(from, y.length()), Math.min(y.length(), at + 120));
            }
        }
        return "no line differs (line endings?)";
    }

    // Query parameters through param(), never pasted into the path pre-encoded: MockMvc encodes the
    // path again, and a zone that arrived as "America%2FNew_York" silently fell back to UTC on the
    // server -- every zoned snapshot of the first generation was really a UTC one.
    private JsonNode read(String path, String token, Map<String, String> params) throws Exception {
        var request = get(path).header("Authorization", "Bearer " + token);
        params.forEach(request::param);
        var response = mockMvc.perform(request).andReturn().getResponse();
        assertEquals(200, response.getStatus(), path + " " + params);
        return objectMapper.readTree(response.getContentAsString());
    }

    private String request(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder builder, String token,
                           Map<String, Object> body) throws Exception {
        return mockMvc.perform(builder.header("Authorization", "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new LinkedHashMap<>(body)))).andReturn().getResponse().getContentAsString();
    }

    private void setPlus(long accountId, boolean plus) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(plus ? SubscriptionStatus.ACTIVE : SubscriptionStatus.FREE);
        subscription.setPlan(plus ? BillingPlan.PLUS : BillingPlan.FREE);
        subscriptionRepository.save(subscription);
    }

    private static <T> List<T> iterable(java.util.Iterator<T> iterator) {
        List<T> list = new ArrayList<>();
        iterator.forEachRemaining(list::add);
        return list;
    }
}
