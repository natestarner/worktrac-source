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
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Verifies the Trends overview (weekly buckets, streak, volume) and per-exercise trend
// (PR marking) computed by StatsService, using a MutableClock to pin "today" so week
// boundaries and the current-week-in-progress streak rule are deterministic. 2026-01-05 is
// a Monday, used throughout as the fixed "current week start."
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class TrendsControllerTest {

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
        clock.advance(Duration.between(clock.instant(), Instant.parse("2026-01-05T12:00:00Z")));

        String email = "trends-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();

        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode firstExercise = objectMapper.readTree(exercisesResponse).get(0);
        exerciseId = firstExercise.get("id").asLong();
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

    private JsonNode getOverview(int weeks) throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/trends/overview?weeks=" + weeks)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    @Test
    void overviewCountsWorkoutsAndVolumePerWeek() throws Exception {
        long sessionId = createPastSession("2026-01-05T09:00:00Z"); // current week
        logSet(sessionId, 100, 10); // 1000 lb
        logSet(sessionId, 50, 10); // 500 lb

        JsonNode overview = getOverview(4);
        JsonNode weeks = overview.get("weeks");
        assertEquals(4, weeks.size());

        JsonNode currentWeek = weeks.get(weeks.size() - 1);
        assertEquals("2026-01-05", currentWeek.get("weekStart").asText());
        assertEquals(1, currentWeek.get("workoutCount").asInt());
        assertEquals(1500.0, currentWeek.get("totalVolumeLb").asDouble());
        assertEquals(1, overview.get("workoutsThisWeek").asInt());
        assertEquals(0, overview.get("workoutsLastWeek").asInt());
    }

    @Test
    void streakBreaksOnGapWeekButCurrentInProgressWeekDoesNot() throws Exception {
        // Two consecutive prior weeks logged, current week (Jan 5) not logged yet.
        logSet(createPastSession("2025-12-22T09:00:00Z"), 100, 5);
        logSet(createPastSession("2025-12-29T09:00:00Z"), 100, 5);

        JsonNode overview = getOverview(6);
        assertEquals(2, overview.get("currentStreakWeeks").asInt(),
                "current week having no workout yet shouldn't break a streak already in progress");
    }

    @Test
    void streakStopsAtAGapWeekEvenWithOlderActivityBeyondIt() throws Exception {
        logSet(createPastSession("2026-01-05T09:00:00Z"), 100, 5); // current week: workout
        // 2025-12-29 (last week): gap, no workout
        logSet(createPastSession("2025-12-22T09:00:00Z"), 100, 5); // two weeks ago: workout, but unreachable past the gap

        JsonNode overview = getOverview(6);
        assertEquals(1, overview.get("currentStreakWeeks").asInt(),
                "a gap week should stop the streak count even if there's older activity further back");
    }

    @Test
    void exerciseTrendMarksNewBestEver1rmAsPr() throws Exception {
        logSet(createPastSession("2025-12-22T09:00:00Z"), 100, 5); // est1rm ~116.7 -> first ever PR
        logSet(createPastSession("2025-12-29T09:00:00Z"), 90, 5); // est1rm ~105 -> lower, not a PR
        logSet(createPastSession("2026-01-05T09:00:00Z"), 120, 5); // est1rm ~140 -> new PR

        String response = mockMvc.perform(get("/api/people/" + personId + "/trends/exercises/" + exerciseId + "?weeks=6")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode points = objectMapper.readTree(response);

        assertEquals(3, points.size());
        assertTrue(points.get(0).get("isPr").asBoolean());
        assertFalse(points.get(1).get("isPr").asBoolean());
        assertTrue(points.get(2).get("isPr").asBoolean());
    }

    @Test
    void exerciseTrendDoesNotReflagAnOlderPrOutsideTheRequestedWindow() throws Exception {
        // A big PR set well before the window, then a smaller set inside the window --
        // the smaller set must not be marked a PR just because the seeding PR is out of view.
        logSet(createPastSession("2025-09-01T09:00:00Z"), 200, 5); // est1rm ~233, outside a 6-week window
        logSet(createPastSession("2026-01-05T09:00:00Z"), 100, 5); // est1rm ~116.7, lower than the earlier PR

        String response = mockMvc.perform(get("/api/people/" + personId + "/trends/exercises/" + exerciseId + "?weeks=6")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode points = objectMapper.readTree(response);

        assertEquals(1, points.size(), "the out-of-window session shouldn't appear as its own point");
        assertFalse(points.get(0).get("isPr").asBoolean());
    }

    @Test
    void exerciseTrendBucketsByTheRequestedZoneNotServerUtc() throws Exception {
        // 2026-01-05T23:30 America/New_York (EST, UTC-5 in January) is 2026-01-06T04:30Z --
        // a session logged late evening local time that has already rolled into the next
        // UTC calendar day. Without the zone param this used to land on "2026-01-06"
        // (wrong day, and liable to collide with a session actually logged the next day).
        long sessionId = createPastSession("2026-01-06T04:30:00Z");
        logSet(sessionId, 100, 5);

        String utcResponse = mockMvc.perform(get("/api/people/" + personId + "/trends/exercises/" + exerciseId + "?weeks=6")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals("2026-01-06", objectMapper.readTree(utcResponse).get(0).get("date").asText(),
                "default (no zone param) buckets by UTC");

        String nyResponse = mockMvc.perform(get("/api/people/" + personId + "/trends/exercises/" + exerciseId
                        + "?weeks=6&zone=America/New_York")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals("2026-01-05", objectMapper.readTree(nyResponse).get(0).get("date").asText(),
                "with zone=America/New_York the session buckets to the viewer's local calendar day");
    }

    @Test
    void overviewBucketsWorkoutCountByTheRequestedZoneNotServerUtc() throws Exception {
        // Same cross-midnight session as above, but checked against the weekly overview's
        // per-day workout counting via workoutsThisWeek/workoutsLastWeek so a session
        // doesn't appear to happen on (or get double-counted against) the wrong day.
        long sessionId = createPastSession("2026-01-06T04:30:00Z");
        logSet(sessionId, 100, 5);

        String nyResponse = mockMvc.perform(get("/api/people/" + personId
                        + "/trends/overview?weeks=4&zone=America/New_York")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode overview = objectMapper.readTree(nyResponse);
        JsonNode weeks = overview.get("weeks");
        assertEquals("2026-01-05", weeks.get(weeks.size() - 1).get("weekStart").asText(),
                "the week containing the session's local calendar day");
        assertEquals(1, overview.get("workoutsThisWeek").asInt());
    }
}
