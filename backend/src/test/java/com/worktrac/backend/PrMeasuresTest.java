package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The four measures the PRs board offers beside est. 1RM.
//
// The point of most of these is that the measures DISAGREE with each other -- a heavy single tops
// the bar but loses on est. 1RM, and the session holding the best single set is not necessarily the
// session with the most total volume. A fixture where they all agree would pass just as happily
// against an implementation that returned the same set for every measure, which is exactly the
// regression worth guarding against.
@AutoConfigureMockMvc
class PrMeasuresTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, PrMeasuresTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long barbellId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "measures-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registration.get("token").asText();
        personId = registration.get("person").get("id").asLong();
        barbellId = createExercise("Measured Bench " + UUID.randomUUID(), "strength");
    }

    @Test
    void everyMeasureIsReportedForALoadedLift() throws Exception {
        // Session A: 100x10 then 100x10  -> volume 2000, reps 20, best set 1000, est1rm 100*(1+10/30)
        long a = createPastSession(daysAgo(20));
        logSet(a, barbellId, 100, 10);
        logSet(a, barbellId, 100, 10);
        // Session B: one heavy single. Top weight lives HERE, but volume and reps do not.
        long b = createPastSession(daysAgo(13));
        logSet(b, barbellId, 200, 1);

        JsonNode measures = rowFor(barbellId).get("measures");

        // Top weight is the heavy single, from session B.
        assertEquals(200.0, measures.get("heaviest").get("value").asDouble(), 0.01);
        assertEquals(1, measures.get("heaviest").get("reps").asInt());
        // Best SESSION volume is session A's 2000, not session B's 200.
        assertEquals(2000.0, measures.get("sessionVolume").get("value").asDouble(), 0.01);
        // Best SINGLE SET volume is 100x10 = 1000, not the session's 2000.
        assertEquals(1000.0, measures.get("bestSetVolume").get("value").asDouble(), 0.01);
        assertEquals(100.0, measures.get("bestSetVolume").get("weightLb").asDouble(), 0.01);
        assertEquals(10, measures.get("bestSetVolume").get("reps").asInt());
        // Best SESSION rep total is A's 20.
        assertEquals(20.0, measures.get("totalReps").get("value").asDouble(), 0.01);
    }

    // The distinction the "session total, not one set" copy exists for. If sessionVolume were
    // computed per set it would report 1000 here, and if bestSetVolume were computed per session it
    // would report 2000 -- this fixture catches either mistake.
    @Test
    void sessionLevelMeasuresPickTheSessionRatherThanTheSet() throws Exception {
        // The session with the best SINGLE SET is deliberately NOT the session with the most volume.
        long heavySingleSet = createPastSession(daysAgo(20));
        logSet(heavySingleSet, barbellId, 300, 5); // one set, volume 1500

        long grindySession = createPastSession(daysAgo(13));
        logSet(grindySession, barbellId, 100, 10); // 1000
        logSet(grindySession, barbellId, 100, 10); // 1000
        logSet(grindySession, barbellId, 100, 10); // 1000 -> session volume 3000, reps 30

        JsonNode measures = rowFor(barbellId).get("measures");

        assertEquals(1500.0, measures.get("bestSetVolume").get("value").asDouble(), 0.01);
        assertEquals(3000.0, measures.get("sessionVolume").get("value").asDouble(), 0.01);
        assertEquals(30.0, measures.get("totalReps").get("value").asDouble(), 0.01);
        // A session-level record names no single set -- no one set is the answer.
        assertTrue(measures.get("sessionVolume").get("weightLb").isNull());
        assertTrue(measures.get("sessionVolume").get("reps").isNull());
        assertTrue(measures.get("totalReps").get("weightLb").isNull());

        // ...but it DOES name the whole session's work. "One session" on its own was unreadable:
        // there was no way to tell a genuine heavy day from ten junk sets of an empty bar, which
        // is precisely how a volume record can be gamed.
        JsonNode breakdown = measures.get("sessionVolume").get("sets");
        assertEquals(1, breakdown.size(), "three identical sets collapse into one run");
        assertEquals(100.0, breakdown.get(0).get("weightLb").asDouble(), 0.01);
        assertEquals(10, breakdown.get(0).get("reps").asInt());
        assertEquals(3, breakdown.get(0).get("count").asInt());
        // The TRUE number of sets, so a truncated list can be labelled honestly.
        assertEquals(3, measures.get("sessionVolume").get("setCount").asInt());
    }

    // A set-level measure already names its own set through weightLb/reps, so it carries no
    // breakdown -- two representations of one thing is what PrRowDto's own header warns about.
    @Test
    void setLevelMeasuresCarryNoBreakdown() throws Exception {
        long session = createPastSession(daysAgo(20));
        logSet(session, barbellId, 225, 5);

        JsonNode measures = rowFor(barbellId).get("measures");

        assertEquals(0, measures.get("heaviest").get("sets").size());
        assertEquals(0, measures.get("heaviest").get("setCount").asInt());
        assertEquals(0, measures.get("bestSetVolume").get("sets").size());
    }

    // Consecutive identical sets collapse; a change of weight or reps starts a new run. Order is
    // chronological, so a ramp reads the way it was actually performed.
    @Test
    void theBreakdownCollapsesRunsAndKeepsChronologicalOrder() throws Exception {
        long session = createPastSession(daysAgo(10));
        logSet(session, barbellId, 135, 10);
        logSet(session, barbellId, 155, 8);
        logSet(session, barbellId, 155, 8);
        logSet(session, barbellId, 175, 6);

        JsonNode breakdown = rowFor(barbellId).get("measures").get("sessionVolume").get("sets");

        assertEquals(3, breakdown.size());
        assertEquals(135.0, breakdown.get(0).get("weightLb").asDouble(), 0.01);
        assertEquals(1, breakdown.get(0).get("count").asInt());
        assertEquals(155.0, breakdown.get(1).get("weightLb").asDouble(), 0.01);
        assertEquals(2, breakdown.get(1).get("count").asInt());
        assertEquals(175.0, breakdown.get(2).get("weightLb").asDouble(), 0.01);
    }

    // ⚠️ The cap exists because this DTO rides on the PRs board -- one row per exercise -- which
    // offlineCacheWarm persists to IndexedDB. setCount must still report the truth, or a long
    // workout would be shown as a shorter one.
    @Test
    void theBreakdownIsCappedButSetCountStaysHonest() throws Exception {
        long session = createPastSession(daysAgo(5));
        // Ten distinct runs, comfortably past the six-run cap.
        for (int i = 0; i < 10; i++) {
            logSet(session, barbellId, 100 + i * 5, 5);
        }

        JsonNode measure = rowFor(barbellId).get("measures").get("sessionVolume");

        assertEquals(6, measure.get("sets").size(), "capped at MAX_PR_BREAKDOWN_RUNS");
        assertEquals(10, measure.get("setCount").asInt(), "but the true total is still reported");
    }

    // Weight-derived measures must be ABSENT, not zero, for an exercise that was never loaded --
    // a column of "0 lb" is worse than no column. Reps survive: they are its honest record.
    @Test
    void weightMeasuresAreNullForABodyweightOnlyExerciseButRepsSurvive() throws Exception {
        long pullUpId = createExercise("Measured Pull-Up " + UUID.randomUUID(), "strength");
        long session = createPastSession(daysAgo(20));
        logSet(session, pullUpId, 0, 12);
        logSet(session, pullUpId, 0, 8);

        JsonNode row = rowFor(pullUpId);
        JsonNode measures = row.get("measures");

        assertTrue(row.get("bodyweightOnly").asBoolean());
        assertTrue(measures.get("heaviest").isNull());
        assertTrue(measures.get("sessionVolume").isNull());
        assertTrue(measures.get("bestSetVolume").isNull());
        assertEquals(20.0, measures.get("totalReps").get("value").asDouble(), 0.01);
    }

    // A hold carries reps = 0, so both volume measures and the rep total collapse to zero the same
    // way a never-loaded exercise collapses the weight ones. Added load still gives a top weight --
    // that is the "heaviest load held" record.
    @Test
    void repAndVolumeMeasuresAreNullForAHoldButAddedLoadStillCounts() throws Exception {
        long plankId = createExercise("Measured Plank " + UUID.randomUUID(), "duration");
        long session = createPastSession(daysAgo(20));
        logHold(session, plankId, 25, 90);
        logHold(session, plankId, 10, 130);

        JsonNode row = rowFor(plankId);
        JsonNode measures = row.get("measures");

        assertTrue(row.get("durationTracked").asBoolean());
        assertTrue(measures.get("totalReps").isNull());
        assertTrue(measures.get("sessionVolume").isNull());
        assertTrue(measures.get("bestSetVolume").isNull());
        assertEquals(25.0, measures.get("heaviest").get("value").asDouble(), 0.01);
    }

    // An unloaded hold has nothing on any of the four. est. 1RM (row.best) still carries its
    // duration, which is the whole reason that one is not inside `measures`.
    @Test
    void anUnloadedHoldHasNoMeasuresAtAllButKeepsItsDuration() throws Exception {
        long plankId = createExercise("Measured Floor Plank " + UUID.randomUUID(), "duration");
        long session = createPastSession(daysAgo(20));
        logHold(session, plankId, 0, 120);

        JsonNode row = rowFor(plankId);

        assertTrue(row.get("measures").get("heaviest").isNull());
        assertTrue(row.get("measures").get("sessionVolume").isNull());
        assertTrue(row.get("measures").get("bestSetVolume").isNull());
        assertTrue(row.get("measures").get("totalReps").isNull());
        assertEquals(120, row.get("best").get("durationSeconds").asInt());
    }

    // Weights are normalized to POUNDS server-side, not left in the set's own unit. That is what
    // lets the client rank and render every measure through one path; prSort.js otherwise has to
    // call toLb per measure, which is exactly the per-call-site derivation that drifts. A set's
    // unit comes from the account default, so this switches the household to kg first.
    @Test
    void measuresAreNormalizedToPounds() throws Exception {
        setDefaultUnit("kg");
        long session = createPastSession(daysAgo(20));
        logSet(session, barbellId, 100, 5);

        JsonNode measures = rowFor(barbellId).get("measures");

        // 100 kg is 220.46 lb, and 100 kg x 5 is 1102.31 lb of volume -- not 100 and 500.
        assertEquals(220.5, measures.get("heaviest").get("value").asDouble(), 0.1);
        assertEquals(1102.3, measures.get("bestSetVolume").get("value").asDouble(), 0.5);
        // The set itself is untouched: only the derived measure is converted.
        assertEquals(100.0, rowFor(barbellId).get("best").get("weight").asDouble(), 0.01);
    }

    // Relative to now, not a date literal. A brand-new account is on Free, whose 90-day window is a
    // read filter on getPrList -- a fixed 2026-05-01 fixture would pass today and silently start
    // returning an empty board once the real clock moved past the window.
    private String daysAgo(int days) {
        return Instant.now().minus(Duration.ofDays(days)).truncatedTo(ChronoUnit.SECONDS).toString();
    }

    private long createExercise(String name, String trackingType) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("trackingType", trackingType);
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private long createPastSession(String startedAt) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + personId + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", startedAt))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private void setDefaultUnit(String unit) throws Exception {
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/account/default-unit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("defaultUnit", unit))))
                .andExpect(status().isOk());
    }

    private void logSet(long sessionId, long exerciseId, double weight, int reps) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("exerciseId", exerciseId);
        body.put("weight", weight);
        body.put("reps", reps);
        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    private void logHold(long sessionId, long exerciseId, double weight, int durationSeconds) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("exerciseId", exerciseId);
        body.put("weight", weight);
        // reps is 0 on a hold, never absent -- a hold genuinely has zero repetitions, and the
        // column is NOT NULL so every rep-derived aggregate stays correct with no null handling.
        body.put("reps", 0);
        body.put("durationSeconds", durationSeconds);
        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    private JsonNode rowFor(long exerciseId) throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/prs")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        for (JsonNode row : objectMapper.readTree(response)) {
            if (row.get("exerciseId").asLong() == exerciseId) return row;
        }
        throw new AssertionError("No PR row for exercise " + exerciseId + " in " + response);
    }
}
