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

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The favorites model that replaced fork-on-edit: preloaded (global) exercises are immutable
// and reached by search; a person curates their own Log picker by favoriting; personalization
// (custom fields, tagging) is per-person and never mutates the shared exercise row.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class ExerciseFavoritesTest {

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
    private String tokenB;
    private long personB1;
    private long benchPressId;

    @BeforeEach
    void setUp() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode regA = register("favA-" + suffix + "@example.com", "Alex");
        tokenA = regA.get("token").asText();
        personA1 = regA.get("person").get("id").asLong();
        JsonNode regB = register("favB-" + suffix + "@example.com", "Blair");
        tokenB = regB.get("token").asText();
        personB1 = regB.get("person").get("id").asLong();

        benchPressId = findByName(catalog(tokenA), "Barbell Bench Press").get("id").asLong();
    }

    private JsonNode register(String email, String personName) throws Exception {
        return RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, personName);
    }

    private JsonNode catalog(String token) throws Exception {
        return objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString());
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

    // --- Preloaded exercises are immutable ---

    @Test
    void editingAPreloadedExerciseIsRejected() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "Renamed", "setupFieldNames", List.of()));
        mockMvc.perform(put("/api/exercises/" + benchPressId)
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());

        // Still exactly as seeded for everyone.
        assertTrue(contains(catalog(tokenA), "Barbell Bench Press"));
        assertTrue(contains(catalog(tokenB), "Barbell Bench Press"));
    }

    @Test
    void deletingAPreloadedExerciseIsRejected() throws Exception {
        mockMvc.perform(delete("/api/exercises/" + benchPressId).header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isForbidden());
        assertTrue(contains(catalog(tokenA), "Barbell Bench Press"));
    }

    @Test
    void editingYourOwnExerciseWorksInPlace() throws Exception {
        long id = addOwnExercise(tokenA, "My Curl");
        String body = objectMapper.writeValueAsString(Map.of("name", "My Curl v2", "setupFieldNames", List.of()));
        mockMvc.perform(put("/api/exercises/" + id)
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
        assertTrue(contains(catalog(tokenA), "My Curl v2"));
        assertFalse(contains(catalog(tokenA), "My Curl"));
    }

    // --- Favoriting drives the per-person picker ---

    @Test
    void favoritingAddsToPickerAndUnfavoritingRemoves() throws Exception {
        assertFalse(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));

        favorite(tokenA, personA1, benchPressId);
        assertTrue(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));

        mockMvc.perform(delete("/api/people/" + personA1 + "/exercises/" + benchPressId + "/favorite")
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk());
        assertFalse(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));
    }

    @Test
    void favoritesAreIsolatedBetweenAccounts() throws Exception {
        favorite(tokenA, personA1, benchPressId);
        assertTrue(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));
        // Account B never favorited it, so it isn't in B's picker.
        assertFalse(contains(pickerList(tokenB, personB1), "Barbell Bench Press"));
    }

    @Test
    void favoritesAreIsolatedBetweenPeopleInTheSameAccount() throws Exception {
        long personA2 = objectMapper.readTree(mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Casey"))))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        favorite(tokenA, personA1, benchPressId);
        assertTrue(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));
        assertFalse(contains(pickerList(tokenA, personA2), "Barbell Bench Press"));
    }

    @Test
    void aLoggedExerciseShowsInThePickerEvenWithoutFavoriting() throws Exception {
        String setBody = objectMapper.writeValueAsString(Map.of("exerciseId", benchPressId, "weight", 135, "reps", 8));
        mockMvc.perform(post("/api/people/" + personA1 + "/live-sets")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(setBody))
                .andExpect(status().isOk());

        JsonNode list = pickerList(tokenA, personA1);
        assertTrue(contains(list, "Barbell Bench Press"));
        // It shows because it's logged, not because it's favorited.
        assertFalse(findByName(list, "Barbell Bench Press").get("isFavorite").asBoolean());
    }

    // --- Personalization overlay: custom fields are per-person and don't touch base data ---

    @Test
    void customFieldsArePerPersonAndDoNotAffectOtherAccounts() throws Exception {
        favorite(tokenA, personA1, benchPressId);
        String fieldBody = objectMapper.writeValueAsString(Map.of("name", "Spotter pin"));
        long fieldId = objectMapper.readTree(mockMvc.perform(post("/api/people/" + personA1 + "/exercises/" + benchPressId + "/custom-fields")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(fieldBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        mockMvc.perform(put("/api/people/" + personA1 + "/exercises/" + benchPressId + "/custom-fields/" + fieldId)
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("value", "3"))))
                .andExpect(status().isOk());

        JsonNode fieldsA = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personA1 + "/exercises/" + benchPressId + "/custom-fields")
                        .header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString());
        assertEquals(1, fieldsA.size());
        assertEquals("3", fieldsA.get(0).get("value").asText());

        // Account B, same shared exercise, sees none of A's custom fields.
        JsonNode fieldsB = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personB1 + "/exercises/" + benchPressId + "/custom-fields")
                        .header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString());
        assertEquals(0, fieldsB.size());
    }

    // --- Per-person tags (shared account vocabulary) ---

    @Test
    void applyingTagsShowsThemOnThePickerEntry() throws Exception {
        favorite(tokenA, personA1, benchPressId);

        setTags(tokenA, personA1, benchPressId, List.of("Chest", "Push"));

        JsonNode entry = findByName(pickerList(tokenA, personA1), "Barbell Bench Press");
        JsonNode tags = entry.get("tags");
        assertEquals(2, tags.size());
        // The DTO sorts tags case-insensitively by name.
        assertEquals("Chest", tags.get(0).get("name").asText());
        assertEquals("Push", tags.get(1).get("name").asText());
    }

    @Test
    void freeTextTaggingReusesExistingAccountTagCaseInsensitively() throws Exception {
        favorite(tokenA, personA1, benchPressId);
        setTags(tokenA, personA1, benchPressId, List.of("Chest"));
        // Re-tagging with a different case must reuse the existing account tag, not duplicate it.
        setTags(tokenA, personA1, benchPressId, List.of("chest", "Push"));

        JsonNode tags = objectMapper.readTree(mockMvc.perform(get("/api/tags")
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        long chestCount = 0;
        boolean hasPush = false;
        for (JsonNode t : tags) {
            if (t.get("name").asText().equalsIgnoreCase("Chest")) chestCount++;
            if (t.get("name").asText().equals("Push")) hasPush = true;
        }
        assertEquals(1, chestCount, "free-text tagging reuses the existing account tag rather than duplicating it");
        assertTrue(hasPush, "a new tag name is added to the shared vocabulary");
    }

    // --- Routine membership auto-favorites ---

    @Test
    void addingAnExerciseToARoutineAutoFavoritesIt() throws Exception {
        assertFalse(contains(pickerList(tokenA, personA1), "Barbell Bench Press"));

        String routineBody = objectMapper.writeValueAsString(Map.of("name", "Push", "exerciseIds", List.of(benchPressId)));
        mockMvc.perform(post("/api/people/" + personA1 + "/routines")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(routineBody))
                .andExpect(status().isOk());

        assertTrue(contains(pickerList(tokenA, personA1), "Barbell Bench Press"),
                "an exercise added to a routine should appear in the picker");
    }

    @Test
    void prListWorksForACustomExercise() throws Exception {
        // A user-created exercise carries no tags. The PR board must not NPE on it.
        long id = addOwnExercise(tokenA, "My Movement");
        String setBody = objectMapper.writeValueAsString(Map.of("exerciseId", id, "weight", 100, "reps", 5));
        mockMvc.perform(post("/api/people/" + personA1 + "/live-sets")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(setBody))
                .andExpect(status().isOk());

        JsonNode prs = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personA1 + "/prs")
                        .header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        boolean found = false;
        for (JsonNode row : prs) {
            if (row.get("exerciseName").asText().equals("My Movement")) found = true;
        }
        assertTrue(found, "the PR board should include the uncategorized custom exercise");
    }

    private void favorite(String token, long personId, long exerciseId) throws Exception {
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + exerciseId + "/favorite")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());
    }

    private void setTags(String token, long personId, long exerciseId, List<String> tagNames) throws Exception {
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + exerciseId + "/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("tags", tagNames))))
                .andExpect(status().isOk());
    }

    private long addOwnExercise(String token, String name) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name, "setupFieldNames", List.of()));
        return objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
    }
}
