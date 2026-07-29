package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Verifies WorkoutSessionService.getOrCreateLiveSession honors a client-supplied
// clientLoggedAt for a BRAND NEW session's startedAt (see WorkoutSetService.logLiveSet,
// which now computes loggedAt before calling getOrCreateLiveSession). Before this fix, a
// set logged offline and replayed later after reconnecting would create its session with
// startedAt = whenever the replay reached the server, not when the workout actually
// started -- this is what the offline-active-loop "Session in progress · started {time}"
// banner surfaces. Uses a MutableClock the same way RestSecondsTest does, to simulate a
// delayed replay deterministically without a real wait.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class LiveSessionClientLoggedAtStartedAtTest {

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

    @Autowired
    private TestCodeCache testCodeCache;

    // EmailService's real constructor builds a live Azure EmailClient from
    // app.email.connection-string, which is empty in the "local" test profile (no real ACS
    // resource in CI) -- @MockitoBean replaces the bean entirely so that constructor never runs.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "live-session-started-at-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();

        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();
    }

    private JsonNode logLiveSet(Map<String, Object> extraFields) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("exerciseId", exerciseId);
        body.put("weight", 135);
        body.put("reps", 8);
        body.putAll(extraFields);
        String response = mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    @Test
    void firstSetOfANewSessionUsesClientLoggedAtAsSessionStartedAt() throws Exception {
        Instant loggedAt = Instant.parse("2026-06-01T10:00:00Z");
        // Simulate the replay reaching the server well after the real offline dispatch --
        // without the fix, this is what the session's startedAt would incorrectly reflect.
        clock.advance(Duration.ofHours(3));

        JsonNode result = logLiveSet(Map.of("clientLoggedAt", loggedAt.toString()));

        Instant sessionStartedAt = Instant.parse(result.get("session").get("startedAt").asText());
        assertEquals(loggedAt, sessionStartedAt,
                "a session auto-created during an offline replay must be stamped with when the workout actually started, not replay time");
    }

    @Test
    void aClientLoggedAtOnASecondSetIntoAnAlreadyExistingSessionDoesNotRewriteItsStartedAt() throws Exception {
        JsonNode first = logLiveSet(Map.of());
        Instant originalStartedAt = Instant.parse(first.get("session").get("startedAt").asText());

        clock.advance(Duration.ofMinutes(10));
        Instant secondSetLoggedAt = Instant.parse("2026-06-02T08:00:00Z");
        JsonNode second = logLiveSet(Map.of("clientLoggedAt", secondSetLoggedAt.toString()));

        Instant sessionStartedAtAfterSecondSet = Instant.parse(second.get("session").get("startedAt").asText());
        // Compared with a small tolerance, not exact/truncated equality: the first response
        // reflects the in-memory Instant from the insert's persistence context, while the
        // second re-reads the row from SQL Server, whose datetime2 column rounds to 100ns.
        // truncatedTo(MICROS) alone isn't enough -- when the true sub-microsecond remainder
        // sits right at a microsecond boundary, that 100ns rounding can push the DB-read value
        // into the *next* whole microsecond (e.g. ...836 vs ...837), which truncation doesn't
        // absorb since it floors rather than rounds. A 1ms tolerance comfortably covers that
        // rounding noise while still failing hard on a genuine rewrite (the 10-minutes-later
        // clock or the unrelated 2026-06-02 clientLoggedAt, both many orders of magnitude
        // outside this tolerance).
        Duration drift = Duration.between(originalStartedAt, sessionStartedAtAfterSecondSet).abs();
        assertTrue(drift.compareTo(Duration.ofMillis(1)) < 0,
                "a clientLoggedAt on a set logged into an already-existing session must never rewrite that session's startedAt (drift: " + drift + ")");
    }
}
