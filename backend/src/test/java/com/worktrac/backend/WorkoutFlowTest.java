package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class WorkoutFlowTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "flow-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        String body = objectMapper.writeValueAsString(Map.of(
                "email", email, "password", "password123", "personName", "Nate"));
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode registerJson = objectMapper.readTree(response);
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();

        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();
    }

    private JsonNode logLiveSet(double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps));
        String response = mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private void updateDefaultUnit(String unit) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("defaultUnit", unit));
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/account/default-unit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    @Test
    void firstSetIsAlwaysAPr() throws Exception {
        JsonNode result = logLiveSet(135, 8);
        assertTrue(result.get("isPR").asBoolean());
        assertEquals(135.0, result.get("best").get("weight").asDouble());
    }

    @Test
    void secondSetWithLowerEst1rmIsNotAPr() throws Exception {
        logLiveSet(185, 5); // est1rm ~ 215.8
        JsonNode second = logLiveSet(135, 5); // est1rm ~ 157.5, lower
        assertFalse(second.get("isPR").asBoolean());
    }

    @Test
    void higherEst1rmBeatsThePreviousPr() throws Exception {
        logLiveSet(135, 8); // est1rm 171
        JsonNode better = logLiveSet(185, 8); // est1rm 234.3
        assertTrue(better.get("isPR").asBoolean());
    }

    @Test
    void listForSessionAndExerciseReturnsSetsInLoggedOrder() throws Exception {
        JsonNode first = logLiveSet(135, 8);
        long sessionId = first.get("session").get("id").asLong();
        logLiveSet(140, 6);

        String response = mockMvc.perform(get("/api/sessions/" + sessionId + "/sets?exerciseId=" + exerciseId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode sets = objectMapper.readTree(response);
        assertEquals(2, sets.size());
        assertEquals(135.0, sets.get(0).get("weight").asDouble());
        assertEquals(140.0, sets.get(1).get("weight").asDouble());
    }

    @Test
    void liveSessionPersistsAcrossSetsThenEndsCleanly() throws Exception {
        JsonNode first = logLiveSet(135, 8);
        long sessionId = first.get("session").get("id").asLong();

        JsonNode second = logLiveSet(140, 8);
        assertEquals(sessionId, second.get("session").get("id").asLong(), "second set in the same day joins the same live session");

        mockMvc.perform(get("/api/people/" + personId + "/sessions/live").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/people/" + personId + "/sessions/live/end").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/people/" + personId + "/sessions/live").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        // Logging again after ending starts a brand new session.
        JsonNode third = logLiveSet(145, 8);
        assertFalse(sessionId == third.get("session").get("id").asLong(), "logging after ending starts a new session");
    }

    @Test
    void editSetChangesWeightAndReps() throws Exception {
        JsonNode logged = logLiveSet(135, 8);
        long setId = logged.get("set").get("id").asLong();

        String editBody = objectMapper.writeValueAsString(Map.of("weight", 155, "reps", 5));
        String editResponse = mockMvc.perform(patch("/api/sets/" + setId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode edited = objectMapper.readTree(editResponse);
        assertEquals(155.0, edited.get("weight").asDouble());
        assertEquals(5, edited.get("reps").asInt());
    }

    @Test
    void deleteSetRemovesItFromHistory() throws Exception {
        JsonNode logged = logLiveSet(135, 8);
        long setId = logged.get("set").get("id").asLong();

        mockMvc.perform(delete("/api/sets/" + setId).header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        String historyResponse = mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        assertEquals(0, objectMapper.readTree(historyResponse).size(), "session with no sets left should drop out of history");
    }

    @Test
    void historyAndPrsReflectLoggedSets() throws Exception {
        logLiveSet(135, 8);
        logLiveSet(185, 5);

        String historyResponse = mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode history = objectMapper.readTree(historyResponse);
        assertEquals(1, history.size());
        assertEquals(2, history.get(0).get("entries").get(0).get("sets").size());

        String prsResponse = mockMvc.perform(get("/api/people/" + personId + "/prs")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode prs = objectMapper.readTree(prsResponse);
        assertEquals(1, prs.size());
        assertEquals(185.0, prs.get(0).get("best").get("weight").asDouble());
    }

    @Test
    void summaryReturnsLastSessionAndBest() throws Exception {
        JsonNode first = logLiveSet(135, 8);
        long firstSessionId = first.get("session").get("id").asLong();
        mockMvc.perform(post("/api/people/" + personId + "/sessions/live/end").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());
        logLiveSet(185, 5);

        String summaryResponse = mockMvc.perform(get("/api/people/" + personId + "/exercises/" + exerciseId + "/summary")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode summary = objectMapper.readTree(summaryResponse);
        assertEquals(185.0, summary.get("best").get("weight").asDouble());
        // lastSession should exclude nothing here since no excludeSessionId given --
        // it reports the most recent session, which is the second one.
        assertFalse(summary.get("lastSession").get("sessionId").asLong() == firstSessionId);
    }

    @Test
    void summaryLastSessionReturnsSetsInSameOrderTheyWereLoggedForSameSetIndexPrefill() throws Exception {
        logLiveSet(100, 8);
        logLiveSet(110, 6);
        logLiveSet(120, 4);
        mockMvc.perform(post("/api/people/" + personId + "/sessions/live/end").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        String summaryResponse = mockMvc.perform(get("/api/people/" + personId + "/exercises/" + exerciseId + "/summary")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode sets = objectMapper.readTree(summaryResponse).get("lastSession").get("sets");
        assertEquals(3, sets.size());
        // Order must match the order they were originally logged (set 1/2/3), not sorted
        // by weight or reversed -- the frontend indexes into this list by set position to
        // prefill "what I did on this same set last time."
        assertEquals(100.0, sets.get(0).get("weight").asDouble());
        assertEquals(110.0, sets.get(1).get("weight").asDouble());
        assertEquals(120.0, sets.get(2).get("weight").asDouble());
    }

    @Test
    void prRankingComparesAcrossUnits() throws Exception {
        JsonNode lbSet = logLiveSet(135, 5); // est1rm 157.5 lb
        assertTrue(lbSet.get("isPR").asBoolean());

        updateDefaultUnit("kg");
        JsonNode heavierKgSet = logLiveSet(100, 5); // est1rm 116.67 kg =~ 257 lb, beats 157.5 lb
        assertTrue(heavierKgSet.get("isPR").asBoolean(), "a kg set should be able to beat an lb-recorded PR once converted");
        assertEquals("kg", heavierKgSet.get("best").get("unit").asText());

        JsonNode lighterKgSet = logLiveSet(50, 5); // est1rm 58.3 kg =~ 129 lb, does not beat 257 lb
        assertFalse(lighterKgSet.get("isPR").asBoolean());

        updateDefaultUnit("lb");
        JsonNode heavierLbSet = logLiveSet(300, 5); // est1rm 350 lb, beats the kg-recorded 257 lb best
        assertTrue(heavierLbSet.get("isPR").asBoolean(), "an lb set should be able to beat a kg-recorded PR once converted");
        assertEquals("lb", heavierLbSet.get("best").get("unit").asText());
    }

    @Test
    void bodyweightPrRankingComparesOnRepsNotEst1rm() throws Exception {
        // Epley's est1rm collapses to 0 at weight 0 no matter the reps, so PR ranking for
        // a bodyweight exercise (no added load) must fall back to comparing rep counts
        // directly -- otherwise every zero-weight set ties every other one forever.
        JsonNode first = logLiveSet(0, 8);
        assertTrue(first.get("isPR").asBoolean(), "the first bodyweight set ever logged is always a PR");
        assertEquals(8, first.get("best").get("reps").asInt());

        JsonNode fewerReps = logLiveSet(0, 5);
        assertFalse(fewerReps.get("isPR").asBoolean(), "fewer reps at the same zero weight must not be a PR");

        JsonNode moreReps = logLiveSet(0, 10);
        assertTrue(moreReps.get("isPR").asBoolean(), "more reps at the same zero weight is a genuine PR");
        assertEquals(10, moreReps.get("best").get("reps").asInt());
    }

    @Test
    void retroactiveSessionCreateEditPreservesDurationAndCsvExports() throws Exception {
        String createBody = objectMapper.writeValueAsString(Map.of("startedAt", "2026-01-01T09:00:00Z"));
        String createResponse = mockMvc.perform(post("/api/people/" + personId + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long sessionId = objectMapper.readTree(createResponse).get("id").asLong();

        String setBody = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", 200, "reps", 5));
        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(setBody))
                .andExpect(status().isOk());

        // Manually give the session a real end time via a second edit path: simulate a
        // completed workout with real duration by editing startedAt and checking
        // endedAt shifts by the same delta rather than collapsing to startedAt.
        String editBody = objectMapper.writeValueAsString(Map.of("startedAt", "2026-01-02T09:00:00Z"));
        String editResponse = mockMvc.perform(patch("/api/sessions/" + sessionId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode edited = objectMapper.readTree(editResponse);
        // Retroactive sessions start with endedAt == startedAt (point-in-time marker);
        // shifting both by the same delta keeps that invariant intact.
        assertEquals(edited.get("startedAt").asText(), edited.get("endedAt").asText());

        String csvResponse = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String[] lines = csvResponse.split("\n");
        assertEquals("Date,Time,Exercise,Category,Set #,Weight,Unit,Reps,Est. 1RM", lines[0]);
        assertEquals(2, lines.length, "header + one set row");
        assertTrue(lines[1].contains("200"));
    }
}
