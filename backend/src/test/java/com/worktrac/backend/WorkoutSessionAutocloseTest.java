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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Verifies the 8-hour session-staleness rule (WorkoutSessionService.AUTOCLOSE) without a
// real wait, by overriding the app's Clock bean with a MutableClock this test can advance.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class WorkoutSessionAutocloseTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    // A distinct bean name from the production ClockConfig's "clock" bean -- Spring Boot
    // rejects same-name bean registration outright (regardless of @Primary) unless
    // bean-definition overriding is explicitly enabled, which we don't want to flip
    // globally just for this one test.
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
        String email = "autoclose-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
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

    @Test
    void sessionInactiveForOver8HoursIsTreatedAsOverAndReplacedByANewOne() throws Exception {
        JsonNode first = logLiveSet(135, 8);
        long firstSessionId = first.get("session").get("id").asLong();

        // Push the clock past the 8-hour staleness window without touching the session again.
        clock.advance(Duration.ofHours(8).plusMinutes(1));

        JsonNode second = logLiveSet(140, 8);
        long secondSessionId = second.get("session").get("id").asLong();
        assertFalse(firstSessionId == secondSessionId, "a set logged after 8h of inactivity should start a brand new session");

        String historyResponse = mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode history = objectMapper.readTree(historyResponse);
        assertEquals(2, history.size(), "both the stale session and the new one should appear in history");

        // Most recent first: the new (still live) session, then the stale one.
        JsonNode newest = history.get(0);
        JsonNode stale = history.get(1);
        assertEquals(secondSessionId, newest.get("sessionId").asLong());
        assertTrue(newest.get("endedAt").isNull(), "the new session is still live");
        assertEquals(firstSessionId, stale.get("sessionId").asLong());
        // A stale session is closed with endedAt == its last activity (its only set's time),
        // not "now" -- confirms it wasn't silently extended by the second set's arrival.
        assertEquals(stale.get("startedAt").asText(), stale.get("endedAt").asText());
    }
}
