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
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Multi-row / multi-session / multi-exercise CSV export correctness -- the existing
// WorkoutFlowTest CSV coverage only ever checks the header and a single data row.
@AutoConfigureMockMvc
class CsvExportControllerTest extends AbstractIntegrationTest {

    private static final String HEADER = "Date,Time,Session Type,Exercise,Tags,Favorite,Custom Fields,"
            + "Exercise Note,Session Note,Set #,Weight,Unit,Reps,Duration (sec),Rest (sec),Est. 1RM";

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, CsvExportControllerTest.class);
    }

    // A MutableClock (same pattern as RestSecondsTest) so the "two live sets N seconds apart"
    // scenario is exact and doesn't depend on how fast the test happens to run -- and so
    // advancing it stays well inside WorkoutSessionService's 8-hour AUTOCLOSE window, unlike a
    // hardcoded past clientLoggedAt would (that reopens a brand-new session every call, since a
    // new session's lastActivityAt is its startedAt, checked against the REAL clock).
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

    @BeforeEach
    void setUp() throws Exception {
        String email = "csv-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();
    }

    private JsonNode logLiveSet(long exerciseId, double weight, int reps) throws Exception {
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
    void exportsMultipleSessionsAndExercisesWithCorrectSetNumberingAndEscaping() throws Exception {
        long exerciseA = createExercise("Exercise A");
        long exerciseB = createExercise("Exercise B");

        // Tag Exercise A with a comma-containing tag, to exercise CSV quote-escaping in the
        // per-person Tags column.
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + exerciseA + "/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("tags", List.of("Full Body, Conditioning")))))
                .andExpect(status().isOk());

        // Session 1: two sets of Exercise A, one set of Exercise B, then explicitly ended.
        logLiveSet(exerciseA, 135, 8);
        logLiveSet(exerciseA, 140, 8);
        logLiveSet(exerciseB, 95, 10);
        mockMvc.perform(post("/api/people/" + personId + "/sessions/live/end").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        // Session 2 (a fresh live session): one more set of Exercise A -- Set # must
        // reset back to 1 here, not continue from session 1's count of 2.
        logLiveSet(exerciseA, 150, 5);

        String csvResponse = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String[] lines = csvResponse.split("\n");

        assertEquals(HEADER, lines[0]);
        assertEquals(5, lines.length, "header + 4 set rows (2 for A in session 1, 1 for B in session 1, 1 for A in session 2)");

        // Sessions ordered oldest-first: session 1's three rows, then session 2's row.
        String[] row1 = splitCsvLine(lines[1]);
        assertEquals("Exercise A", row1[3]);
        assertEquals("Full Body, Conditioning", row1[4], "comma-containing tag name should round-trip through quote-escaping");
        assertEquals("1", row1[9], "first set of Exercise A in session 1 is Set # 1");
        assertEquals("135.00", row1[10]);
        assertEquals("lb", row1[11]);
        assertEquals("8", row1[12]);

        String[] row2 = splitCsvLine(lines[2]);
        assertEquals("Exercise A", row2[3]);
        assertEquals("2", row2[9], "second set of Exercise A in session 1 is Set # 2");

        String[] row3 = splitCsvLine(lines[3]);
        assertEquals("Exercise B", row3[3]);
        assertEquals("1", row3[9], "Exercise B's only set in session 1 is Set # 1");

        String[] row4 = splitCsvLine(lines[4]);
        assertEquals("Exercise A", row4[3]);
        assertEquals("1", row4[9], "Exercise A's set in session 2 resets back to Set # 1, not continuing session 1's count");
    }

    // Regression coverage for the bug this change fixes: every set in a session used to be
    // stamped with the SESSION's startedAt, so two sets logged apart within the same session
    // showed identical Date/Time. Each row must instead reflect its own set's created_at. Also
    // covers Rest (sec), which only exists at all because each set's real created_at is distinct.
    @Test
    void dateAndTimeReflectEachSetsOwnCreatedAtNotTheSessionStartAndRestSecondsIsExact() throws Exception {
        long exercise = createExercise("Deadlift");

        JsonNode first = logLiveSet(exercise, 315, 5);
        clock.advance(Duration.ofSeconds(90));
        JsonNode second = logLiveSet(exercise, 315, 5);

        // The two ISO-8601 createdAt strings the server actually stamped -- Date/Time in the
        // CSV must match THESE, not a session-level timestamp.
        String firstCreatedAt = first.get("set").get("createdAt").asText();
        String secondCreatedAt = second.get("set").get("createdAt").asText();
        assertNotEquals(firstCreatedAt.substring(0, 16), secondCreatedAt.substring(0, 16),
                "the two sets must have genuinely distinct created_at values for this test to prove anything");

        String csvResponse = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String[] lines = csvResponse.split("\n");
        String[] row1 = splitCsvLine(lines[1]);
        String[] row2 = splitCsvLine(lines[2]);

        assertEquals(firstCreatedAt.substring(0, 10), row1[0], "Date must be the FIRST set's own created_at");
        assertEquals(firstCreatedAt.substring(11, 16), row1[1], "Time must be the FIRST set's own created_at");
        assertEquals(secondCreatedAt.substring(0, 10), row2[0], "Date must be the SECOND set's own created_at");
        assertEquals(secondCreatedAt.substring(11, 16), row2[1],
                "Time must be the SECOND set's own created_at, not identical to the first set's (the bug this fixes)");

        // Rest (sec): blank for the session's first set of this exercise, exactly 90 for the
        // second (the MutableClock advance above, with no real-wall-clock jitter to absorb).
        assertEquals("", row1[14]);
        assertEquals("90", row2[14]);

        // Both sets went through the live-session endpoint.
        assertEquals("Live", row1[2]);
        assertEquals("Live", row2[2]);
    }

    // A set logged into an explicit past/retroactive session (WorkoutSetService.logSetIntoSession)
    // always gets a null rest_seconds, even for a second set of the same exercise -- see
    // workout-data-model.md. Session Type must read "Logged Later" there, "Live" everywhere else.
    @Test
    void sessionTypeIsLoggedLaterForARetroactiveSessionAndRestSecondsStaysBlank() throws Exception {
        long exercise = createExercise("Overhead Press");

        String pastSessionResponse = mockMvc.perform(post("/api/people/" + personId + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", "2026-08-15T09:00:00Z"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long pastSessionId = objectMapper.readTree(pastSessionResponse).get("id").asLong();

        logSetIntoSession(pastSessionId, exercise, 95, 8);
        logSetIntoSession(pastSessionId, exercise, 95, 8);

        String csvResponse = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String[] lines = csvResponse.split("\n");
        String[] row1 = splitCsvLine(lines[1]);
        String[] row2 = splitCsvLine(lines[2]);

        assertEquals("Logged Later", row1[2]);
        assertEquals("Logged Later", row2[2]);
        assertEquals("", row1[14], "logSetIntoSession never computes rest_seconds");
        assertEquals("", row2[14], "logSetIntoSession never computes rest_seconds, even for a repeat of the same exercise");
    }

    private void logSetIntoSession(long sessionId, long exerciseId, double weight, int reps) throws Exception {
        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps))))
                .andExpect(status().isOk());
    }

    // Favorite, a custom field, the standing exercise note, and a session-scoped note are all
    // per-(person, exercise) or per-(session, exercise) personalization -- confirms each lands in
    // its own column, repeated on every row for that exercise/session the way Tags already does.
    @Test
    void includesFavoriteCustomFieldsAndBothKindsOfNote() throws Exception {
        long exercise = createExercise("Romanian Deadlift");

        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + exercise + "/favorite")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + exercise + "/note")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("note", "Go light -- bad knee"))))
                .andExpect(status().isOk());

        String fieldResponse = mockMvc.perform(post("/api/people/" + personId + "/exercises/" + exercise + "/custom-fields")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Band"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long fieldId = objectMapper.readTree(fieldResponse).get("id").asLong();
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + exercise + "/custom-fields/" + fieldId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Band", "value", "Red"))))
                .andExpect(status().isOk());

        logLiveSet(exercise, 95, 10);

        mockMvc.perform(put("/api/people/" + personId + "/live-exercise-notes")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("exerciseId", exercise, "note", "Felt strong today"))))
                .andExpect(status().isOk());

        String csvResponse = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String[] row = splitCsvLine(csvResponse.split("\n")[1]);

        assertEquals("Yes", row[5]);
        assertEquals("Band: Red", row[6]);
        assertEquals("Go light -- bad knee", row[7]);
        assertEquals("Felt strong today", row[8]);
    }

    @Test
    void favoriteReadsNoWhenNeverFavorited() throws Exception {
        long exercise = createExercise("Lat Pulldown");
        logLiveSet(exercise, 100, 10);

        String csvResponse = mockMvc.perform(get("/api/people/" + personId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String[] row = splitCsvLine(csvResponse.split("\n")[1]);

        assertEquals("No", row[5]);
        assertEquals("", row[6], "no custom fields added");
        assertEquals("", row[7], "no standing note added");
        assertEquals("", row[8], "no session note added");
    }

    // Minimal quote-aware CSV field splitter matching CsvExportService's own escaping
    // (fields containing a comma/quote/newline are wrapped in double quotes, with
    // embedded quotes doubled) -- enough to unpick a single data row for assertions.
    private String[] splitCsvLine(String line) {
        List<String> fields = new java.util.ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuotes) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    current.append('"');
                    i++;
                } else if (c == '"') {
                    inQuotes = false;
                } else {
                    current.append(c);
                }
            } else if (c == '"') {
                inQuotes = true;
            } else if (c == ',') {
                fields.add(current.toString());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString());
        return fields.toArray(new String[0]);
    }

    private long createExercise(String name) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "name", name));
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }
}
