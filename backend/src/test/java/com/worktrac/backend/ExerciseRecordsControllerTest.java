package com.worktrac.backend;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
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

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Covers the all-time records endpoint (GET /api/people/{id}/exercises/{id}/records): the
// "at least N reps" rep-max rule, cross-unit normalization, and the bodyweight-only escape hatch.
// Uses the same MutableClock-pinned 2026-01-05 Monday as TrendsControllerTest so record dates are
// deterministic.
@AutoConfigureMockMvc
class ExerciseRecordsControllerTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ExerciseRecordsControllerTest.class);
    }

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MutableClock clock;

    @Autowired
    private TestCodeCache testCodeCache;

    // See TrendsControllerTest -- the real EmailService constructor builds a live Azure client
    // from a connection string the "local" test profile leaves empty.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        clock.advance(Duration.between(clock.instant(), Instant.parse("2026-01-05T12:00:00Z")));

        String email = "records-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();

        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();
    }

    private long createPastSession(String startedAt) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("startedAt", startedAt));
        String response = mockMvc.perform(post("/api/people/" + personId + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private void logSet(long sessionId, double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps));
        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private void setDefaultUnit(String unit) throws Exception {
        mockMvc.perform(put("/api/account/default-unit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("defaultUnit", unit))))
                .andExpect(status().isOk());
    }

    private JsonNode getRecords() throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/exercises/" + exerciseId + "/records")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode repMaxFor(JsonNode records, int target) {
        for (JsonNode repMax : records.get("repMaxes")) {
            if (repMax.get("repTarget").asInt() == target) {
                return repMax;
            }
        }
        throw new AssertionError("no rep max row for target " + target);
    }

    @Test
    void repMaxesMeanAtLeastNRepsNotExactlyNReps() throws Exception {
        long session = createPastSession("2026-01-05T09:00:00Z");
        logSet(session, 150, 3);
        logSet(session, 100, 10);

        JsonNode records = getRecords();

        // 150x3 is the heaviest set that reached 1 and 3 reps.
        assertEquals(150.0, repMaxFor(records, 1).get("weightLb").asDouble());
        assertEquals(150.0, repMaxFor(records, 3).get("weightLb").asDouble());
        assertEquals(3, repMaxFor(records, 3).get("reps").asInt());
        // At 5+ reps the 150 set no longer qualifies, so the 100x10 set takes over. Under an
        // exactly-N reading this row would be empty, which is the whole point of the >= rule.
        assertEquals(100.0, repMaxFor(records, 5).get("weightLb").asDouble());
        assertEquals(10, repMaxFor(records, 5).get("reps").asInt(),
                "the row reports the set that actually set it, so 5+ can read 'x10'");
        assertEquals(100.0, repMaxFor(records, 10).get("weightLb").asDouble());
    }

    @Test
    void repMaxTargetNoSetEverReachedIsNull() throws Exception {
        logSet(createPastSession("2026-01-05T09:00:00Z"), 100, 10);

        JsonNode twelve = repMaxFor(getRecords(), 12);
        assertTrue(twelve.get("weightLb").isNull(), "nothing has ever been done for 12+ reps");
        assertTrue(twelve.get("reps").isNull());
        assertTrue(twelve.get("date").isNull());
    }

    @Test
    void repMaxBreaksWeightTiesOnTheHigherRepCount() throws Exception {
        long session = createPastSession("2026-01-05T09:00:00Z");
        logSet(session, 185, 5);
        logSet(session, 185, 8);

        JsonNode fiveRepMax = repMaxFor(getRecords(), 5);
        assertEquals(185.0, fiveRepMax.get("weightLb").asDouble());
        assertEquals(8, fiveRepMax.get("reps").asInt(), "same weight, more reps is the better record");
    }

    @Test
    void recordsNormalizeMixedUnitHistoryToLb() throws Exception {
        logSet(createPastSession("2025-12-29T09:00:00Z"), 100, 5); // 100 lb

        setDefaultUnit("kg");
        logSet(createPastSession("2026-01-05T09:00:00Z"), 50, 5); // 50 kg = 110.231 lb

        JsonNode records = getRecords();
        assertEquals(110.2, records.get("heaviestWeight").get("valueLb").asDouble(), 0.05,
                "the kg set is genuinely heavier once normalized");
        assertEquals("2026-01-05", records.get("heaviestWeight").get("date").asText());
        assertEquals(110.2, repMaxFor(records, 5).get("weightLb").asDouble(), 0.05);
    }

    @Test
    void allTimeRecordsCoverHeaviestBestSetVolumeBestSessionVolumeAndMostReps() throws Exception {
        long earlier = createPastSession("2025-12-29T09:00:00Z");
        logSet(earlier, 225, 2);  // heaviest on the bar; set volume 450
        logSet(earlier, 135, 10); // set volume 1350 -> session volume 1800

        long later = createPastSession("2026-01-05T09:00:00Z");
        logSet(later, 155, 12);   // best single-set volume 1860 and most reps -> session volume 1860

        JsonNode records = getRecords();

        assertEquals(225.0, records.get("heaviestWeight").get("valueLb").asDouble());
        assertEquals(2, records.get("heaviestWeight").get("reps").asInt());
        assertEquals("2025-12-29", records.get("heaviestWeight").get("date").asText());

        assertEquals(1860.0, records.get("bestSetVolume").get("valueLb").asDouble());
        assertEquals("2026-01-05", records.get("bestSetVolume").get("date").asText());

        assertEquals(1860.0, records.get("bestSessionVolume").get("valueLb").asDouble());
        assertEquals("2026-01-05", records.get("bestSessionVolume").get("date").asText());
        assertTrue(records.get("bestSessionVolume").get("weightLb").isNull(),
                "a session record isn't attributable to one set");

        assertEquals(12.0, records.get("mostReps").get("valueLb").asDouble());
        assertEquals(155.0, records.get("mostReps").get("weightLb").asDouble());

        assertEquals(3, records.get("totalSets").asInt());
        assertEquals(24, records.get("totalReps").asInt());
        assertEquals(3660.0, records.get("totalVolumeLb").asDouble());
        assertFalse(records.get("bodyweightOnly").asBoolean());
    }

    @Test
    void bodyweightOnlyFlipsTrueWhenNoSetEverCarriedLoad() throws Exception {
        long session = createPastSession("2026-01-05T09:00:00Z");
        logSet(session, 0, 8);
        logSet(session, 0, 12);

        JsonNode records = getRecords();
        assertTrue(records.get("bodyweightOnly").asBoolean());
        assertEquals(12.0, records.get("mostReps").get("valueLb").asDouble(),
                "reps are the only real record for a bodyweight lift");
        assertEquals(20, records.get("totalReps").asInt());
        assertEquals(0.0, records.get("totalVolumeLb").asDouble(),
                "weight x reps is genuinely 0 -- the client shows reps instead of this");
    }

    @Test
    void oneLoadedSetIsEnoughToStopBeingBodyweightOnly() throws Exception {
        long session = createPastSession("2026-01-05T09:00:00Z");
        logSet(session, 0, 10);
        logSet(session, 25, 6); // weighted pull-up

        assertFalse(getRecords().get("bodyweightOnly").asBoolean());
    }

    @Test
    void anExerciseWithNoSetsReturnsAnEmptyShellRatherThanFailing() throws Exception {
        JsonNode records = getRecords();

        assertEquals(0, records.get("repMaxes").size());
        assertTrue(records.get("heaviestWeight").isNull());
        assertTrue(records.get("bestSessionVolume").isNull());
        assertEquals(0, records.get("totalSets").asInt());
        assertFalse(records.get("bodyweightOnly").asBoolean());
    }

    @Test
    void recordsDatesUseTheRequestedZoneNotServerUtc() throws Exception {
        // 2026-01-05 23:30 in New York, already 2026-01-06 in UTC.
        logSet(createPastSession("2026-01-06T04:30:00Z"), 100, 5);

        String utcResponse = mockMvc.perform(get("/api/people/" + personId + "/exercises/" + exerciseId + "/records")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals("2026-01-06", objectMapper.readTree(utcResponse).get("heaviestWeight").get("date").asText());

        String nyResponse = mockMvc.perform(get("/api/people/" + personId + "/exercises/" + exerciseId
                        + "/records?zone=America/New_York")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals("2026-01-05", objectMapper.readTree(nyResponse).get("heaviestWeight").get("date").asText());
    }

    @Test
    void recordsAreScopedToTheOwningAccount() throws Exception {
        logSet(createPastSession("2026-01-05T09:00:00Z"), 100, 5);

        String otherEmail = "records-other-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode otherJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, otherEmail, "Stranger");
        String otherToken = otherJson.get("token").asText();

        mockMvc.perform(get("/api/people/" + personId + "/exercises/" + exerciseId + "/records")
                        .header("Authorization", "Bearer " + otherToken))
                .andExpect(status().isNotFound());
    }
}
