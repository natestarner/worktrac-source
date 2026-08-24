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

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Duration-tracked exercises: a set measured in seconds held rather than repetitions.
//
// The load-bearing case here is measureMismatchIsLenientAboutTheLegacyShape. A 4xx is the only
// thing that ends a durable write's retries (shouldRetryWrite), so every rejection in
// WorkoutSetService#resolveMeasure permanently destroys a set that may have been queued in the
// offline outbox for an entire outage. Rejecting too much is a data-loss bug, not a strictness
// preference.
@AutoConfigureMockMvc
class EnduranceExerciseTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, EnduranceExerciseTest.class);
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
    private long plankId;
    private long benchId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "endurance-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();

        JsonNode catalog = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString());
        plankId = findExercise(catalog, "Wall Sit");
        benchId = findExercise(catalog, "Barbell Bench Press");
    }

    private long findExercise(JsonNode catalog, String name) {
        for (JsonNode e : catalog) {
            if (name.equals(e.get("name").asText())) {
                return e.get("id").asLong();
            }
        }
        throw new AssertionError("seeded exercise not in the catalog: " + name);
    }

    // HashMap, not Map.of -- these payloads deliberately carry nulls, which Map.of rejects.
    private Map<String, Object> payload(long exerciseId, double weight, Integer reps, Integer durationSeconds) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("exerciseId", exerciseId);
        body.put("weight", weight);
        body.put("reps", reps);
        body.put("durationSeconds", durationSeconds);
        return body;
    }

    private JsonNode logLiveSet(Map<String, Object> body) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    @Test
    void seededHoldsAreDurationTrackedAndSeededLiftsAreNot() throws Exception {
        JsonNode catalog = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString());

        Map<String, String> byName = new HashMap<>();
        for (JsonNode e : catalog) {
            byName.put(e.get("name").asText(), e.get("trackingType").asText());
        }

        assertEquals("duration", byName.get("Wall Sit"));
        assertEquals("duration", byName.get("Dead Hang"));
        assertEquals("duration", byName.get("Jump Rope"));
        // Things you COUNT stay reps, even when they are conditioning movements.
        assertEquals("strength", byName.get("Burpee"));
        assertEquals("strength", byName.get("Mountain Climber"));
        assertEquals("strength", byName.get("Barbell Bench Press"));
    }

    // V50 retires the "(sec)" naming hack. Those exercises were never rep-based -- the suffix told
    // the person to type seconds into the Reps field -- so the conversion is a rename plus moving
    // the stored numbers into duration_seconds, with nothing reinterpreted.
    @Test
    void theLegacySecondsExercisesAreConvertedAndRenamed() throws Exception {
        JsonNode catalog = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString());

        Map<String, String> byName = new HashMap<>();
        for (JsonNode e : catalog) {
            byName.put(e.get("name").asText(), e.get("trackingType").asText());
        }

        assertEquals("duration", byName.get("Plank"), "Plank (sec) should be a duration exercise named Plank");
        assertEquals("duration", byName.get("Side Plank"));
        assertFalse(byName.containsKey("Plank (sec)"), "the naming hack should be gone from the picker");
        assertFalse(byName.containsKey("Side Plank (sec)"));
    }

    @Test
    void aHoldIsStoredAsSecondsWithZeroReps() throws Exception {
        JsonNode result = logLiveSet(payload(plankId, 0, 0, 45));

        JsonNode set = result.get("set");
        assertEquals(45, set.get("durationSeconds").asInt());
        assertEquals(0, set.get("reps").asInt(), "a hold has zero repetitions -- see WorkoutSet");
        assertTrue(result.get("isPR").asBoolean(), "the first hold of an exercise is always a PR");
        assertTrue(result.get("best").get("est1rm").isNull(), "a hold has no est. 1RM");
        assertEquals(45, result.get("best").get("durationSeconds").asInt());
    }

    @Test
    void addedLoadIsRecordedOnAHoldWithoutANewField() throws Exception {
        JsonNode set = logLiveSet(payload(plankId, 25, 0, 60)).get("set");
        assertEquals(25, set.get("weight").asDouble());
        assertEquals(60, set.get("durationSeconds").asInt());
    }

    @Test
    void aLongerHoldIsAPrAndAShorterOneIsNot() throws Exception {
        logLiveSet(payload(plankId, 0, 0, 45));
        assertTrue(logLiveSet(payload(plankId, 0, 0, 60)).get("isPR").asBoolean());
        assertFalse(logLiveSet(payload(plankId, 0, 0, 30)).get("isPR").asBoolean());
    }

    // The documented, deliberate limitation: seconds alone decide the ranking, so more load at a
    // shorter hold is not a PR. "Heaviest load held" is the separate record that keeps it visible.
    @Test
    void addedLoadDoesNotEnterTheHoldRankingButGetsItsOwnRecord() throws Exception {
        logLiveSet(payload(plankId, 0, 0, 90));
        assertFalse(logLiveSet(payload(plankId, 45, 0, 60)).get("isPR").asBoolean());

        JsonNode records = objectMapper.readTree(mockMvc.perform(
                        get("/api/people/" + personId + "/exercises/" + plankId + "/records")
                                .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());

        assertTrue(records.get("durationTracked").asBoolean());
        assertTrue(records.get("bestEst1rm").isNull(), "a hold has no est. 1RM");
        assertTrue(records.get("mostReps").isNull(), "a hold has no rep record");
        assertEquals(90, records.get("longestHold").get("durationSeconds").asInt());
        assertEquals(60, records.get("heaviestLoadHeld").get("durationSeconds").asInt());
        assertEquals(45.0, records.get("heaviestLoadHeld").get("weightLb").asDouble());
        assertEquals(150, records.get("totalHoldSeconds").asInt());
    }

    @Test
    void aHoldContributesNoVolumeOrRepsButStillCountsAsASet() throws Exception {
        logLiveSet(payload(plankId, 25, 0, 60));

        JsonNode records = objectMapper.readTree(mockMvc.perform(
                        get("/api/people/" + personId + "/exercises/" + plankId + "/records")
                                .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString());

        assertEquals(1, records.get("totalSets").asInt());
        assertEquals(0, records.get("totalReps").asInt());
        assertEquals(0.0, records.get("totalVolumeLb").asDouble());
    }

    // The export is the one place these numbers leave the app, so a blank cell where a column
    // doesn't apply matters more than usual -- a 0 in the Reps column would read as a real
    // measurement in a spreadsheet, and an Est. 1RM for a hold would be a fabricated number.
    @Test
    void theCsvExportSeparatesDurationFromReps() throws Exception {
        logLiveSet(payload(plankId, 20, 0, 65));
        logLiveSet(payload(benchId, 135, 8, null));

        String csv = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String[] lines = csv.split("\n");
        assertEquals("Date,Time,Session Type,Exercise,Tags,Favorite,Custom Fields,Exercise Note,Session Note,"
                + "Set #,Weight,Unit,Reps,Duration (sec),Rest (sec),Est. 1RM", lines[0].trim());

        String holdRow = null;
        String liftRow = null;
        for (String line : lines) {
            if (line.contains("Wall Sit")) holdRow = line;
            if (line.contains("Barbell Bench Press")) liftRow = line;
        }

        assertTrue(holdRow != null && holdRow.contains(",65,"), "the hold's seconds belong in Duration: " + holdRow);
        // Reps and Est. 1RM are both empty for a hold -- ",," between Unit and Duration.
        assertTrue(holdRow.contains(",lb,,65,"), "a hold has no rep count: " + holdRow);
        assertTrue(liftRow != null && liftRow.contains(",8,,"), "a lift has reps and an empty Duration: " + liftRow);
    }

    @Test
    void aStrengthExerciseRejectsADuration() throws Exception {
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(payload(benchId, 135, 8, 60))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aHoldRejectsRepsAlongsideItsDuration() throws Exception {
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(payload(plankId, 0, 8, 60))))
                .andExpect(status().isBadRequest());
    }

    // ⚠️ The one that matters most. A client whose cached exercise catalog predates a conversion
    // still believes this exercise is rep-tracked and sends reps with no duration. Rejecting that
    // would 4xx, and a 4xx is terminal for a durable write -- the queued set would be destroyed
    // rather than retried. Those reps ARE seconds (that is what the old "(sec)" naming meant), so
    // they are accepted and stored as the duration.
    @Test
    void measureMismatchIsLenientAboutTheLegacyShape() throws Exception {
        JsonNode set = logLiveSet(payload(plankId, 0, 50, null)).get("set");

        assertEquals(50, set.get("durationSeconds").asInt(), "legacy reps are read as seconds");
        assertEquals(0, set.get("reps").asInt());
    }

    @Test
    void aHoldWithNeitherMeasureIsRejected() throws Exception {
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(payload(plankId, 0, 0, null))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void editingAHoldChangesItsDurationAndLeavesRestSecondsAlone() throws Exception {
        long setId = logLiveSet(payload(plankId, 0, 0, 45)).get("set").get("id").asLong();

        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("weight", 10);
        edit.put("reps", 0);
        edit.put("durationSeconds", 70);

        String response = mockMvc.perform(patch("/api/sets/" + setId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(edit)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        JsonNode set = objectMapper.readTree(response);
        assertEquals(70, set.get("durationSeconds").asInt());
        assertEquals(10.0, set.get("weight").asDouble());
        assertEquals(0, set.get("reps").asInt());
        assertTrue(set.get("restSeconds").isNull(), "restSeconds is immutable and this was a first set");
    }

    // rest_seconds keys off WHICH ENDPOINT handled the write, never off the measure -- adding a
    // second measure must not have quietly changed that.
    @Test
    void holdsStillGetRestSecondsFromTheLiveEndpointOnly() throws Exception {
        assertTrue(logLiveSet(payload(plankId, 0, 0, 30)).get("set").get("restSeconds").isNull(),
                "first set of an exercise has nothing to diff against");
        assertFalse(logLiveSet(payload(plankId, 0, 0, 30)).get("set").get("restSeconds").isNull(),
                "a second live hold gets a real rest gap");
    }

    @Test
    void aHouseholdCanCreateItsOwnTimedExercise() throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Ring Support Hold");
        body.put("trackingType", "duration");

        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        JsonNode created = objectMapper.readTree(response);
        assertEquals("duration", created.get("trackingType").asText());

        JsonNode set = logLiveSet(payload(created.get("id").asLong(), 0, 0, 20)).get("set");
        assertEquals(20, set.get("durationSeconds").asInt());
    }

    @Test
    void anUnknownTrackingTypeIsRejected() throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Nonsense");
        body.put("trackingType", "distance");

        mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createDefaultsToStrengthWhenTrackingTypeIsOmitted() throws Exception {
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Zercher Squat"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertEquals("strength", objectMapper.readTree(response).get("trackingType").asText());
    }
}
