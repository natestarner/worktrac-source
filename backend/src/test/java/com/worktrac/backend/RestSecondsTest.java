package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Verifies WorkoutSetService's rest_seconds rule (see the V17 migration, WorkoutSet.java,
// and WorkoutSetService.java for the full design): live sets get a real rest_seconds
// derived from the prior same-exercise set's created_at; anything logged through
// logSetIntoSession (manual/backfilled sessions, or an old session resumed via History's
// Edit button to add a forgotten set) always gets null, regardless of the session's
// `manual` flag or how much real time has passed. Uses a MutableClock the same way
// WorkoutSessionAutocloseTest does, to advance time deterministically without a real wait.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class RestSecondsTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

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

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "rest-seconds-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
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

    private JsonNode logSetIntoSession(long sessionId, double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps));
        String response = mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    @Test
    void firstLiveSetOfAnExerciseHasNoRestSecondsThenLaterOnesReflectElapsedTime() throws Exception {
        JsonNode first = logLiveSet(135, 8);
        assertTrue(first.get("set").get("restSeconds").isNull(), "nothing to diff the first set of an exercise against");

        clock.advance(Duration.ofMinutes(10));

        JsonNode second = logLiveSet(140, 8);
        int restSeconds = second.get("set").get("restSeconds").asInt();
        // A loose lower bound rather than an exact match: MutableClock's baseline is
        // captured once at bean construction (during Spring context/Testcontainer
        // startup), while the prior set's created_at is stamped with the real wall clock
        // at whatever moment this test body actually runs -- the two aren't perfectly
        // synchronized, and cumulative advances from other tests sharing this context
        // only ever push this value up, never down. A "did it move by roughly the
        // expected amount, and clearly not stay near zero" check is what actually
        // matters here.
        assertTrue(restSeconds > 500, "expected roughly 600s of advanced time to show up, was " + restSeconds);
    }

    @Test
    void restSecondsIsNullForSetsLoggedIntoAManualPastSession() throws Exception {
        String createBody = objectMapper.writeValueAsString(Map.of("startedAt", "2026-01-01T09:00:00Z"));
        String createResponse = mockMvc.perform(post("/api/people/" + personId + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long sessionId = objectMapper.readTree(createResponse).get("id").asLong();

        JsonNode firstInSession = logSetIntoSession(sessionId, 135, 8);
        assertTrue(firstInSession.get("set").get("restSeconds").isNull());

        JsonNode secondInSession = logSetIntoSession(sessionId, 140, 8);
        assertTrue(secondInSession.get("set").get("restSeconds").isNull(),
                "a manual/backfilled session's sets never get rest_seconds, even for the 2nd+ set of the exercise");
    }

    @Test
    void restSecondsIsNullWhenResumingAnOldNonManualLiveSessionToAppendAForgottenSet() throws Exception {
        // This session started out as an ordinary live session (manual = false) -- the
        // exact case that a "null only if session.manual" rule would miss.
        JsonNode first = logLiveSet(135, 8);
        long sessionId = first.get("session").get("id").asLong();
        mockMvc.perform(post("/api/people/" + personId + "/sessions/live/end").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        clock.advance(Duration.ofDays(3));

        // Resuming it via logSetIntoSession (what History's "Edit" flow does) to add a
        // forgotten set, days later, must still get null -- not a multi-day "rest."
        JsonNode resumed = logSetIntoSession(sessionId, 140, 8);
        assertTrue(resumed.get("set").get("restSeconds").isNull());
    }
}
