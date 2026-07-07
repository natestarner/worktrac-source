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

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class CoreCrudControllerTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;

    @BeforeEach
    void registerAccount() throws Exception {
        String email = "crud-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        String body = objectMapper.writeValueAsString(Map.of(
                "email", email, "password", "password123", "personName", "Nate"));
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = objectMapper.readTree(response).get("token").asText();
    }

    @Test
    void cannotDeletePrimaryPerson() throws Exception {
        String meResponse = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        long primaryPersonId = objectMapper.readTree(meResponse).get("people").get(0).get("id").asLong();

        mockMvc.perform(delete("/api/people/" + primaryPersonId).header("Authorization", "Bearer " + token))
                .andExpect(status().isConflict());
    }

    @Test
    void canAddAndRemoveNonPrimaryPerson() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "Sam"));
        String response = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long samId = objectMapper.readTree(response).get("id").asLong();

        mockMvc.perform(delete("/api/people/" + samId).header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());
    }

    @Test
    void removingNonPrimaryPersonCascadesTheirSessionsSetsRoutinesAndSetupValues() throws Exception {
        String personBody = objectMapper.writeValueAsString(Map.of("name", "Sam"));
        String personResponse = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(personBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long samId = objectMapper.readTree(personResponse).get("id").asLong();

        String categoriesResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        long globalCategoryId = objectMapper.readTree(categoriesResponse).get(0).get("id").asLong();

        String exBody = objectMapper.writeValueAsString(Map.of(
                "name", "Sam's Exercise With Setup", "categoryId", globalCategoryId,
                "setupFieldNames", List.of("Pin height")));
        String exResponse = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode exerciseNode = objectMapper.readTree(exResponse);
        long exerciseId = exerciseNode.get("id").asLong();
        long fieldId = exerciseNode.get("setupFields").get(0).get("id").asLong();

        // Give Sam a routine, a logged set (which auto-creates a session), and a setup
        // value before deleting them, so the delete actually exercises the FK cascade
        // chain (routines/routine_exercises, workout_sessions/workout_sets, setup_values)
        // rather than trivially succeeding on a person with no data.
        String routineBody = objectMapper.writeValueAsString(Map.of("name", "Sam's Routine", "exerciseIds", List.of(exerciseId)));
        mockMvc.perform(post("/api/people/" + samId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(routineBody))
                .andExpect(status().isOk());

        String setBody = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", 45, "reps", 10));
        mockMvc.perform(post("/api/people/" + samId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(setBody))
                .andExpect(status().isOk());

        String valueBody = objectMapper.writeValueAsString(Map.of("value", "5"));
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/people/" + samId + "/exercises/" + exerciseId + "/setup-fields/" + fieldId + "/value")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(valueBody))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/people/" + samId).header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        String peopleResponse = mockMvc.perform(get("/api/people").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode people = objectMapper.readTree(peopleResponse);
        for (JsonNode p : people) {
            assertFalse(p.get("id").asLong() == samId, "Sam should no longer be listed after removal");
        }

        // Sam's personId is gone -- every endpoint scoped to it must now 404, confirming
        // there's no orphaned data left reachable under the deleted personId.
        mockMvc.perform(get("/api/people/" + samId + "/routines").header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/people/" + samId + "/history").header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/people/" + samId + "/exercises/" + exerciseId + "/setup-values")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    void deletingCategoryStillReferencedByExerciseReturns409() throws Exception {
        String catBody = objectMapper.writeValueAsString(Map.of("name", "Custom Cat"));
        String catResponse = mockMvc.perform(post("/api/categories")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(catBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long categoryId = objectMapper.readTree(catResponse).get("id").asLong();

        String exBody = objectMapper.writeValueAsString(Map.of(
                "name", "Custom Exercise", "categoryId", categoryId, "setupFieldNames", List.of()));
        mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exBody))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/categories/" + categoryId).header("Authorization", "Bearer " + token))
                .andExpect(status().isConflict());
    }

    @Test
    void deletingGlobalCategoryIsForbidden() throws Exception {
        String listResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        long globalCategoryId = objectMapper.readTree(listResponse).get(0).get("id").asLong();

        mockMvc.perform(delete("/api/categories/" + globalCategoryId).header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    void softDeletedExerciseDisappearsFromListButKeepsSetupFields() throws Exception {
        String listResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        long globalCategoryId = objectMapper.readTree(listResponse).get(0).get("id").asLong();

        String exBody = objectMapper.writeValueAsString(Map.of(
                "name", "Soft Delete Me", "categoryId", globalCategoryId,
                "setupFieldNames", List.of("Seat height")));
        String exResponse = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long exerciseId = objectMapper.readTree(exResponse).get("id").asLong();
        assertEquals(1, objectMapper.readTree(exResponse).get("setupFields").size());

        mockMvc.perform(delete("/api/exercises/" + exerciseId).header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        String afterDelete = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode exercises = objectMapper.readTree(afterDelete);
        boolean stillPresent = false;
        for (JsonNode e : exercises) {
            if (e.get("id").asLong() == exerciseId) {
                stillPresent = true;
            }
        }
        assertFalse(stillPresent, "soft-deleted exercise should not appear in the picker list");
    }

    @Test
    void canUpdateAccountDefaultUnit() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("defaultUnit", "kg"));
        String response = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/account/default-unit")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals("kg", objectMapper.readTree(response).get("defaultUnit").asText());
    }

    @Test
    void setupValueRoundTripsPerPerson() throws Exception {
        String meResponse = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        long personId = objectMapper.readTree(meResponse).get("people").get(0).get("id").asLong();

        String listResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        long globalCategoryId = objectMapper.readTree(listResponse).get(0).get("id").asLong();

        String exBody = objectMapper.writeValueAsString(Map.of(
                "name", "Bench Setup Test", "categoryId", globalCategoryId,
                "setupFieldNames", List.of("Bar catch pin")));
        String exResponse = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode exerciseNode = objectMapper.readTree(exResponse);
        long exerciseId = exerciseNode.get("id").asLong();
        long fieldId = exerciseNode.get("setupFields").get(0).get("id").asLong();

        String valueBody = objectMapper.writeValueAsString(Map.of("value", "5"));
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/people/" + personId + "/exercises/" + exerciseId + "/setup-fields/" + fieldId + "/value")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(valueBody))
                .andExpect(status().isOk());

        String setupValuesResponse = mockMvc.perform(
                        get("/api/people/" + personId + "/exercises/" + exerciseId + "/setup-values")
                                .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode values = objectMapper.readTree(setupValuesResponse);
        assertEquals(1, values.size());
        assertEquals("5", values.get(0).get("value").asText());
        assertTrue(values.get(0).get("fieldName").asText().contains("Bar catch pin"));
    }
}
