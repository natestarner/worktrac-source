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
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Editing/deleting a shared "system" exercise forks a private, account-owned copy on
// first touch -- this is the single most important behavior to get right here: other
// households must never see the fork, and the forking household's own history must
// follow the fork rather than staying pinned to the (now-hidden) original.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class ExerciseForkTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    // EmailService's real constructor builds a live Azure EmailClient from
    // app.email.connection-string, which is empty in the "local" test profile (no real ACS
    // resource in CI) -- @MockitoBean replaces the bean entirely so that constructor never runs.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String tokenA;
    private long personIdA;
    private String tokenB;
    private long benchPressId;

    @BeforeEach
    void setUp() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        JsonNode regA = register("forkA-" + suffix + "@example.com", "Alex");
        tokenA = regA.get("token").asText();
        personIdA = regA.get("person").get("id").asLong();
        tokenB = register("forkB-" + suffix + "@example.com", "Blair").get("token").asText();

        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        JsonNode exercises = objectMapper.readTree(exercisesResponse);
        benchPressId = findByName(exercises, "Barbell Bench Press").get("id").asLong();
    }

    private JsonNode register(String email, String personName) throws Exception {
        return RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, personName);
    }

    private JsonNode findByName(JsonNode exercises, String name) {
        for (JsonNode e : exercises) {
            if (e.get("name").asText().equals(name)) return e;
        }
        throw new AssertionError("No exercise named " + name);
    }

    @Test
    void editingSystemExerciseForksItAndLeavesOtherAccountsUntouched() throws Exception {
        long categoryId = findByName(
                objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                        .andReturn().getResponse().getContentAsString()),
                "Barbell Bench Press").get("categoryId").asLong();

        String editBody = objectMapper.writeValueAsString(Map.of(
                "name", "Bench Press (Renamed)", "categoryId", categoryId, "setupFieldNames", List.of()));
        String editResponse = mockMvc.perform(put("/api/exercises/" + benchPressId)
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode forked = objectMapper.readTree(editResponse);
        assertNotEquals(benchPressId, forked.get("id").asLong(), "editing a system exercise must create a new, distinct row");
        assertFalse(forked.get("isGlobal").asBoolean());
        assertEquals("Bench Press (Renamed)", forked.get("name").asText());

        // Account A's list now shows the fork under the new name, not the original.
        JsonNode listA = objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString());
        assertTrue(contains(listA, "Bench Press (Renamed)"));
        assertFalse(contains(listA, "Barbell Bench Press"), "the original name should no longer appear once forked");

        // Account B is completely unaffected -- still sees the original, unrenamed.
        JsonNode listB = objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString());
        assertTrue(contains(listB, "Barbell Bench Press"));
        assertFalse(contains(listB, "Bench Press (Renamed)"));
    }

    @Test
    void historicalSetsFollowTheForkAfterEditing() throws Exception {
        String setBody = objectMapper.writeValueAsString(Map.of("exerciseId", benchPressId, "weight", 135, "reps", 8));
        mockMvc.perform(post("/api/people/" + personIdA + "/live-sets")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(setBody))
                .andExpect(status().isOk());

        long categoryId = findByName(
                objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                        .andReturn().getResponse().getContentAsString()),
                "Barbell Bench Press").get("categoryId").asLong();
        String editBody = objectMapper.writeValueAsString(Map.of(
                "name", "Chest Press", "categoryId", categoryId, "setupFieldNames", List.of()));
        mockMvc.perform(put("/api/exercises/" + benchPressId)
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editBody))
                .andExpect(status().isOk());

        String historyResponse = mockMvc.perform(get("/api/people/" + personIdA + "/history")
                        .header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        JsonNode history = objectMapper.readTree(historyResponse);
        String entryName = history.get(0).get("entries").get(0).get("exerciseName").asText();
        assertEquals("Chest Press", entryName, "the previously-logged set must follow the fork to its new name");
    }

    @Test
    void deletingSystemExerciseHidesItOnlyForThatAccount() throws Exception {
        mockMvc.perform(delete("/api/exercises/" + benchPressId).header("Authorization", "Bearer " + tokenA))
                .andExpect(status().isNoContent());

        JsonNode listA = objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString());
        assertFalse(contains(listA, "Barbell Bench Press"));

        JsonNode listB = objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString());
        assertTrue(contains(listB, "Barbell Bench Press"));
    }

    @Test
    void setupValuesMigrateToTheForkedFields() throws Exception {
        // Bench Press is seeded with "Bar catch pin" and "Spotter arm pin" setup fields.
        JsonNode exercise = findByName(
                objectMapper.readTree(mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                        .andReturn().getResponse().getContentAsString()),
                "Barbell Bench Press");
        long fieldId = exercise.get("setupFields").get(0).get("id").asLong();
        long categoryId = exercise.get("categoryId").asLong();

        String valueBody = objectMapper.writeValueAsString(Map.of("value", "5"));
        mockMvc.perform(put("/api/people/" + personIdA + "/exercises/" + benchPressId + "/setup-fields/" + fieldId + "/value")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(valueBody))
                .andExpect(status().isOk());

        String editBody = objectMapper.writeValueAsString(Map.of(
                "name", "Barbell Bench Press", "categoryId", categoryId,
                "setupFieldNames", List.of("Bar catch pin", "Spotter arm pin")));
        String editResponse = mockMvc.perform(put("/api/exercises/" + benchPressId)
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long forkedId = objectMapper.readTree(editResponse).get("id").asLong();
        long forkedFieldId = objectMapper.readTree(editResponse).get("setupFields").get(0).get("id").asLong();

        String valuesResponse = mockMvc.perform(get("/api/people/" + personIdA + "/exercises/" + forkedId + "/setup-values")
                        .header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        JsonNode values = objectMapper.readTree(valuesResponse);
        assertEquals(1, values.size());
        assertEquals(forkedFieldId, values.get(0).get("fieldId").asLong());
        assertEquals("5", values.get(0).get("value").asText());
    }

    private boolean contains(JsonNode exercises, String name) {
        for (JsonNode e : exercises) {
            if (e.get("name").asText().equals(name)) return true;
        }
        return false;
    }
}
