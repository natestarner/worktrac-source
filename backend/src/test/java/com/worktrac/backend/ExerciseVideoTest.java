package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.exercise.ExerciseVideoChecker;
import com.worktrac.backend.exercise.VideoAvailabilityProbe;
import com.worktrac.backend.exercise.VideoAvailabilityProbe.Availability;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// How-to videos on library exercises (V94): carried on the catalogue only while active, never on a
// household's own exercise, and hidden/restored by the daily checker on a definite answer only.
@AutoConfigureMockMvc
class ExerciseVideoTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ExerciseVideoTest.class);
    }

    private static final String BENCH = "Barbell Bench Press";
    private static final String SQUAT = "Barbell Back Squat";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ExerciseVideoChecker checker;

    @MockitoBean
    private EmailService emailService;

    // Never the real YouTube from a test.
    @MockitoBean
    private VideoAvailabilityProbe probe;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;

    @BeforeEach
    void setUp() throws Exception {
        jdbcTemplate.update("DELETE FROM exercise_videos");
        String email = "videos-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
    }

    private void addVideo(String exerciseName, String videoId, Integer start, String status) {
        jdbcTemplate.update("""
                INSERT INTO exercise_videos (exercise_id, video_id, start_seconds, source_label, status)
                SELECT id, ?, ?, 'Muscle & Strength', ? FROM exercises
                WHERE name = ? AND account_id IS NULL
                """, videoId, start, status, exerciseName);
    }

    private JsonNode catalogRow(String name) throws Exception {
        String body = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        for (JsonNode row : objectMapper.readTree(body)) {
            if (row.get("name").asText().equals(name)) {
                return row;
            }
        }
        throw new AssertionError("no catalogue row named " + name);
    }

    private String statusOf(String exerciseName) {
        return jdbcTemplate.queryForObject("""
                SELECT v.status FROM exercise_videos v JOIN exercises e ON e.id = v.exercise_id
                WHERE e.name = ? AND e.account_id IS NULL
                """, String.class, exerciseName);
    }

    @Test
    void anActiveLibraryVideoIsOnTheCatalogueAsAnIdNeverAUrl() throws Exception {
        addVideo(BENCH, "j7ULT6dznNc", 12, "active");

        JsonNode video = catalogRow(BENCH).get("video");
        assertEquals("youtube", video.get("provider").asText());
        assertEquals("j7ULT6dznNc", video.get("videoId").asText());
        assertEquals(12, video.get("startSeconds").asInt());
        assertEquals("Muscle & Strength", video.get("sourceLabel").asText());
        assertEquals(4, video.size(), "the DTO carries exactly provider, id, start and label -- no URL");
    }

    @Test
    void anExerciseWithNoVideoCarriesNull() throws Exception {
        assertTrue(catalogRow(SQUAT).get("video").isNull());
    }

    @Test
    void anUnavailableVideoIsNotSent() throws Exception {
        addVideo(BENCH, "j7ULT6dznNc", null, "unavailable");
        assertTrue(catalogRow(BENCH).get("video").isNull());
    }

    @Test
    void aHouseholdsOwnExerciseNeverCarriesAVideo() throws Exception {
        String body = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Zorp Press\",\"trackingType\":\"strength\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        long id = objectMapper.readTree(body).get("id").asLong();
        // Nothing writes this, but if a row ever pointed at a household exercise it must not show.
        jdbcTemplate.update("INSERT INTO exercise_videos (exercise_id, video_id, source_label) VALUES (?, 'j7ULT6dznNc', 'x')", id);

        assertTrue(catalogRow("Zorp Press").get("video").isNull());
    }

    @Test
    void theCheckerHidesAVideoYouTubeSaysIsGoneAndShowsItAgainWhenItReturns() throws Exception {
        addVideo(BENCH, "j7ULT6dznNc", null, "active");

        when(probe.check(anyString())).thenReturn(Availability.UNAVAILABLE);
        ExerciseVideoChecker.Summary gone = checker.checkAll();
        assertEquals(1, gone.unavailable());
        assertEquals(1, gone.changed());
        assertEquals("unavailable", statusOf(BENCH));
        assertTrue(catalogRow(BENCH).get("video").isNull());

        when(probe.check(anyString())).thenReturn(Availability.AVAILABLE);
        ExerciseVideoChecker.Summary back = checker.checkAll();
        assertEquals(1, back.changed());
        assertEquals("active", statusOf(BENCH));
        assertEquals("j7ULT6dznNc", catalogRow(BENCH).get("video").get("videoId").asText());
    }

    // A YouTube outage, a timeout or a rate limit must never hide every video.
    @Test
    void noDefiniteAnswerChangesNothing() {
        addVideo(BENCH, "j7ULT6dznNc", null, "active");
        addVideo(SQUAT, "aaaaaaaaaaa", null, "unavailable");

        when(probe.check(anyString())).thenReturn(Availability.UNKNOWN);
        ExerciseVideoChecker.Summary summary = checker.checkAll();

        assertEquals(2, summary.unknown());
        assertEquals(0, summary.changed());
        assertEquals("active", statusOf(BENCH));
        assertEquals("unavailable", statusOf(SQUAT));
        Integer checked = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM exercise_videos WHERE checked_at IS NOT NULL", Integer.class);
        assertEquals(0, checked, "checked_at records a definite answer only");
    }
}
