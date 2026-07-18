package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Two independent, coexisting note types on an exercise (see CLAUDE.md's plan discussion):
//   * A standing per-person note (person_exercise.note) shown every session, isolated the
//     same way favorites/tags already are.
//   * A per-session note (session_exercise_notes) scoped to one workout, surfaced back to
//     the person via the "last time" summary the next time they do the exercise.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class ExerciseNotesTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String tokenA;
    private long personA1;
    private long personA2;
    private String tokenB;
    private long personB1;
    private long benchPressId;

    @BeforeEach
    void setUp() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode regA = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, "notesA-" + suffix + "@example.com", "Nate");
        tokenA = regA.get("token").asText();
        personA1 = regA.get("person").get("id").asLong();
        personA2 = objectMapper.readTree(mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Junior"))))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        JsonNode regB = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, "notesB-" + suffix + "@example.com", "Blair");
        tokenB = regB.get("token").asText();
        personB1 = regB.get("person").get("id").asLong();

        JsonNode catalog = objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString());
        for (JsonNode e : catalog) {
            if (e.get("name").asText().equals("Barbell Bench Press")) {
                benchPressId = e.get("id").asLong();
                break;
            }
        }
    }

    // --- Persistent (per-person) note ---

    @Test
    void persistentNoteIsSavedAndReturned() throws Exception {
        JsonNode dto = setPersistentNote(tokenA, personA1, "Keep elbows tucked, pause at chest");
        assertEquals("Keep elbows tucked, pause at chest", dto.get("note").asText());
    }

    @Test
    void settingAPersistentNoteAddsTheExerciseToThePickerEvenWithoutFavoritingOrLogging() throws Exception {
        // Never favorited, never logged -- only a note. Without picker inclusion, the
        // frontend's personExercises.find() would miss it and fall back to the note-less
        // catalog DTO, making the note invisible right after saving it.
        assertFalse(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));

        setPersistentNote(tokenA, personA1, "Bar is loaded to 45lb");

        JsonNode entry = findByName(pickerList(tokenA, personA1), "Barbell Bench Press");
        assertEquals("Bar is loaded to 45lb", entry.get("note").asText());
    }

    @Test
    void clearingTheOnlyReasonAnExerciseWasInThePickerRemovesIt() throws Exception {
        setPersistentNote(tokenA, personA1, "Temporary note");
        assertTrue(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));

        setPersistentNote(tokenA, personA1, "");

        assertFalse(contains(pickerList(tokenA, personA1), "Barbell Bench Press"),
                "with the note cleared and never favorited/logged, it drops back out of the picker");
    }

    @Test
    void blankPersistentNoteClearsIt() throws Exception {
        setPersistentNote(tokenA, personA1, "Keep elbows tucked");
        JsonNode cleared = setPersistentNote(tokenA, personA1, "   ");
        assertTrue(cleared.get("note").isNull());
    }

    @Test
    void persistentNoteIsIsolatedBetweenPeopleInTheSameAccount() throws Exception {
        setPersistentNote(tokenA, personA1, "Nate's cue: elbows tucked");
        favorite(tokenA, personA2);

        JsonNode entry = findByName(pickerList(tokenA, personA2), "Barbell Bench Press");
        assertTrue(entry.get("note").isNull(), "personA2 never set a note, so they must not see personA1's");
    }

    @Test
    void persistentNoteIsIsolatedBetweenAccounts() throws Exception {
        setPersistentNote(tokenA, personA1, "Nate's cue");
        favorite(tokenB, personB1);

        JsonNode entry = findByName(pickerList(tokenB, personB1), "Barbell Bench Press");
        assertTrue(entry.get("note").isNull());
    }

    // --- Session note ---

    @Test
    void savingALiveNoteMaterializesALiveSessionBeforeAnySetIsLogged() throws Exception {
        mockMvc.perform(get("/api/people/" + personA1 + "/sessions/live").header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNoContent());

        JsonNode saved = saveLiveNote(tokenA, personA1, "Shoulder felt off today, cut it short");
        assertEquals("Shoulder felt off today, cut it short", saved.get("note").asText());
        long sessionId = saved.get("sessionId").asLong();

        mockMvc.perform(get("/api/people/" + personA1 + "/sessions/live").header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk());

        JsonNode fetched = objectMapper.readTree(mockMvc.perform(get("/api/sessions/" + sessionId + "/exercises/" + benchPressId + "/note")
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertEquals("Shoulder felt off today, cut it short", fetched.get("note").asText());
    }

    @Test
    void blankLiveNoteClearsTheSessionNote() throws Exception {
        JsonNode saved = saveLiveNote(tokenA, personA1, "note");
        long sessionId = saved.get("sessionId").asLong();

        JsonNode cleared = saveLiveNote(tokenA, personA1, "   ");
        assertTrue(cleared.get("note").isNull());

        mockMvc.perform(get("/api/sessions/" + sessionId + "/exercises/" + benchPressId + "/note")
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNoContent());
    }

    @Test
    void sessionNoteCannotBeSetOnAnotherAccountsSession() throws Exception {
        JsonNode saved = saveLiveNote(tokenA, personA1, "note");
        long sessionId = saved.get("sessionId").asLong();

        mockMvc.perform(put("/api/sessions/" + sessionId + "/exercises/" + benchPressId + "/note")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("note", "hijack"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void lastTimeSummaryIncludesThePreviousSessionsNoteAndExcludesTheCurrentSession() throws Exception {
        JsonNode first = logLiveSet(135, 8);
        long firstSessionId = first.get("session").get("id").asLong();
        saveLiveNote(tokenA, personA1, "Felt strong");
        mockMvc.perform(post("/api/people/" + personA1 + "/sessions/live/end").header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNoContent());

        JsonNode second = logLiveSet(140, 8); // current (second) session -- no note on this one
        long secondSessionId = second.get("session").get("id").asLong();

        // excludeSessionId matches what the frontend sends for contextSessionId (the
        // session currently being logged into) -- see ExerciseDetail.jsx's refetchSummary.
        JsonNode summary = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personA1 + "/exercises/" + benchPressId + "/summary")
                        .header("Authorization", "Bearer " + tokenA)
                        .param("excludeSessionId", String.valueOf(secondSessionId)))
                .andReturn().getResponse().getContentAsString());
        assertEquals(firstSessionId, summary.get("lastSession").get("sessionId").asLong());
        assertEquals("Felt strong", summary.get("lastSession").get("note").asText());
    }

    @Test
    void lastTimeSummaryOmitsNoteWhenPreviousSessionHasNone() throws Exception {
        JsonNode first = logLiveSet(135, 8);
        long firstSessionId = first.get("session").get("id").asLong();
        mockMvc.perform(post("/api/people/" + personA1 + "/sessions/live/end").header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNoContent());
        JsonNode second = logLiveSet(140, 8);
        long secondSessionId = second.get("session").get("id").asLong();

        JsonNode summary = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personA1 + "/exercises/" + benchPressId + "/summary")
                        .header("Authorization", "Bearer " + tokenA)
                        .param("excludeSessionId", String.valueOf(secondSessionId)))
                .andReturn().getResponse().getContentAsString());
        assertEquals(firstSessionId, summary.get("lastSession").get("sessionId").asLong());
        assertTrue(summary.get("lastSession").get("note").isNull());
    }

    @Test
    void historyIncludesTheSessionNoteOnTheMatchingEntryAndOmitsItForOthers() throws Exception {
        saveLiveNote(tokenA, personA1, "Felt strong");
        logLiveSet(135, 8);
        mockMvc.perform(post("/api/people/" + personA1 + "/sessions/live/end").header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNoContent());
        logLiveSet(140, 8); // second (current) session -- no note on this one

        JsonNode history = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personA1 + "/history")
                        .header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString());
        assertEquals(2, history.size());
        // findByPerson_IdOrderByStartedAtDesc -- most recent (second, note-less) session first.
        assertTrue(history.get(0).get("entries").get(0).get("note").isNull());
        assertEquals("Felt strong", history.get(1).get("entries").get(0).get("note").asText());
    }

    private JsonNode logLiveSet(double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", benchPressId, "weight", weight, "reps", reps));
        return objectMapper.readTree(mockMvc.perform(post("/api/people/" + personA1 + "/live-sets")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private JsonNode setPersistentNote(String token, long personId, String note) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("note", note));
        return objectMapper.readTree(mockMvc.perform(put("/api/people/" + personId + "/exercises/" + benchPressId + "/note")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private JsonNode saveLiveNote(String token, long personId, String note) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", benchPressId, "note", note));
        return objectMapper.readTree(mockMvc.perform(put("/api/people/" + personId + "/live-exercise-notes")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private void favorite(String token, long personId) throws Exception {
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + benchPressId + "/favorite")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    private JsonNode pickerList(String token, long personId) throws Exception {
        return objectMapper.readTree(mockMvc.perform(get("/api/people/" + personId + "/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString());
    }

    private JsonNode findByName(JsonNode exercises, String name) {
        for (JsonNode e : exercises) {
            if (e.get("name").asText().equals(name)) return e;
        }
        throw new AssertionError("No exercise named " + name);
    }

    private boolean contains(JsonNode exercises, String name) {
        for (JsonNode e : exercises) {
            if (e.get("name").asText().equals(name)) return true;
        }
        return false;
    }
}
