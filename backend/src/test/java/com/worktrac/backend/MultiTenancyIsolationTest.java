package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The single most important test in this codebase: confirms Account B's token can never
// read, edit, or delete Account A's rows, and that a mismatched personId/exerciseId/
// categoryId always comes back as 404 (never 403, which would confirm the row exists).
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class MultiTenancyIsolationTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String tokenA;
    private String tokenB;

    @BeforeEach
    void registerTwoAccounts() throws Exception {
        String suffix = java.util.UUID.randomUUID().toString().substring(0, 8);
        tokenA = register("accountA-" + suffix + "@example.com", "Alex");
        tokenB = register("accountB-" + suffix + "@example.com", "Blair");
    }

    private String register(String email, String personName) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "email", email,
                "password", "password123",
                "personName", personName));
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    private long primaryPersonId(String token) throws Exception {
        String response = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("people").get(0).get("id").asLong();
    }

    @Test
    void accountBCannotDeleteAccountAsPerson() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "Alex's Kid"));
        String response = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long personId = objectMapper.readTree(response).get("id").asLong();

        mockMvc.perform(delete("/api/people/" + personId).header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());
    }

    @Test
    void accountBCannotDeleteAccountAsCustomCategory() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", "Account A Custom Category"));
        String response = mockMvc.perform(post("/api/categories")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long categoryId = objectMapper.readTree(response).get("id").asLong();

        mockMvc.perform(delete("/api/categories/" + categoryId).header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        // Also must not appear in B's own list.
        String listResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString();
        JsonNode categories = objectMapper.readTree(listResponse);
        for (JsonNode c : categories) {
            org.junit.jupiter.api.Assertions.assertNotEquals(categoryId, c.get("id").asLong());
        }
    }

    @Test
    void accountBCannotEditOrDeleteAccountAsCustomExercise() throws Exception {
        // Reuse a global category (seeded for every account) rather than creating one.
        String categoriesResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        long globalCategoryId = objectMapper.readTree(categoriesResponse).get(0).get("id").asLong();

        String exerciseBody = objectMapper.writeValueAsString(Map.of(
                "name", "Account A Custom Exercise",
                "categoryId", globalCategoryId,
                "setupFieldNames", java.util.List.of()));
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exerciseBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long exerciseId = objectMapper.readTree(response).get("id").asLong();

        String editBody = objectMapper.writeValueAsString(Map.of(
                "name", "Hijacked name",
                "categoryId", globalCategoryId,
                "setupFieldNames", java.util.List.of()));
        mockMvc.perform(put("/api/exercises/" + exerciseId)
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editBody))
                .andExpect(status().isNotFound());

        mockMvc.perform(delete("/api/exercises/" + exerciseId).header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        String listResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString();
        JsonNode exercises = objectMapper.readTree(listResponse);
        for (JsonNode e : exercises) {
            org.junit.jupiter.api.Assertions.assertNotEquals(exerciseId, e.get("id").asLong());
        }
    }

    @Test
    void accountBCannotReadAccountAsSetupValues() throws Exception {
        long personIdA = primaryPersonId(tokenA);
        String categoriesResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        long globalCategoryId = objectMapper.readTree(categoriesResponse).get(0).get("id").asLong();

        String exerciseBody = objectMapper.writeValueAsString(Map.of(
                "name", "Exercise With Setup Field",
                "categoryId", globalCategoryId,
                "setupFieldNames", java.util.List.of("Pin height")));
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exerciseBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long exerciseId = objectMapper.readTree(response).get("id").asLong();
        long fieldId = objectMapper.readTree(response).get("setupFields").get(0).get("id").asLong();

        // Account B trying to read/write setup values under Account A's own person id
        // must 404, since personId ownership is re-checked server-side regardless of
        // which account created the exercise.
        mockMvc.perform(get("/api/people/" + personIdA + "/exercises/" + exerciseId + "/setup-values")
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        String valueBody = objectMapper.writeValueAsString(Map.of("value", "5"));
        mockMvc.perform(put("/api/people/" + personIdA + "/exercises/" + exerciseId + "/setup-fields/" + fieldId + "/value")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(valueBody))
                .andExpect(status().isNotFound());
    }

    @Test
    void accountBCannotWriteASetupValueAgainstAccountAsPrivateExercise() throws Exception {
        // Account B owns their own person, but the exerciseId belongs to Account A --
        // B's own personId ownership check alone must not be enough to let this through.
        long personIdB = primaryPersonId(tokenB);
        String categoriesResponse = mockMvc.perform(get("/api/categories").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        long globalCategoryId = objectMapper.readTree(categoriesResponse).get(0).get("id").asLong();

        String exerciseBody = objectMapper.writeValueAsString(Map.of(
                "name", "Account A Private Exercise With Field",
                "categoryId", globalCategoryId,
                "setupFieldNames", java.util.List.of("Pin height")));
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(exerciseBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long exerciseId = objectMapper.readTree(response).get("id").asLong();
        long fieldId = objectMapper.readTree(response).get("setupFields").get(0).get("id").asLong();

        mockMvc.perform(get("/api/people/" + personIdB + "/exercises/" + exerciseId + "/setup-values")
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());

        String valueBody = objectMapper.writeValueAsString(Map.of("value", "5"));
        mockMvc.perform(put("/api/people/" + personIdB + "/exercises/" + exerciseId + "/setup-fields/" + fieldId + "/value")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(valueBody))
                .andExpect(status().isNotFound());
    }

    @Test
    void accountBCannotEditOrDeleteAccountAsSessionOrSets() throws Exception {
        long personIdA = primaryPersonId(tokenA);
        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        long exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();

        String setBody = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", 135, "reps", 8));
        String setResponse = mockMvc.perform(post("/api/people/" + personIdA + "/live-sets")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(setBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode logged = objectMapper.readTree(setResponse);
        long sessionId = logged.get("session").get("id").asLong();
        long setId = logged.get("set").get("id").asLong();

        String editSessionBody = objectMapper.writeValueAsString(Map.of("startedAt", "2026-01-01T09:00:00Z"));
        mockMvc.perform(patch("/api/sessions/" + sessionId)
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editSessionBody))
                .andExpect(status().isNotFound());

        String addSetBody = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", 100, "reps", 5));
        mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(addSetBody))
                .andExpect(status().isNotFound());

        String editSetBody = objectMapper.writeValueAsString(Map.of("weight", 200, "reps", 3));
        mockMvc.perform(patch("/api/sets/" + setId)
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(editSetBody))
                .andExpect(status().isNotFound());

        mockMvc.perform(delete("/api/sets/" + setId).header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());
    }

    @Test
    void accountBCannotEditOrDeleteAccountAsRoutine() throws Exception {
        long personIdA = primaryPersonId(tokenA);
        long personIdB = primaryPersonId(tokenB);
        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        long exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();

        String routineBody = objectMapper.writeValueAsString(Map.of(
                "name", "Account A Routine", "exerciseIds", java.util.List.of(exerciseId)));
        String routineResponse = mockMvc.perform(post("/api/people/" + personIdA + "/routines")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(routineBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long routineId = objectMapper.readTree(routineResponse).get("id").asLong();

        // B has no access to A's person id at all, so B must use their own (owned)
        // personId in the path -- confirming the routine isn't reachable there either.
        String updateBody = objectMapper.writeValueAsString(Map.of(
                "name", "Hijacked", "exerciseIds", java.util.List.of(exerciseId)));
        mockMvc.perform(put("/api/people/" + personIdB + "/routines/" + routineId)
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isNotFound());

        mockMvc.perform(delete("/api/people/" + personIdB + "/routines/" + routineId)
                        .header("Authorization", "Bearer " + tokenB))
                .andExpect(status().isNotFound());
    }

    @Test
    void accountBCannotCopyAccountAsRoutine() throws Exception {
        long personIdA = primaryPersonId(tokenA);
        long personIdB = primaryPersonId(tokenB);
        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + tokenA))
                .andReturn().getResponse().getContentAsString();
        long exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();

        String routineBody = objectMapper.writeValueAsString(Map.of(
                "name", "Account A Routine", "exerciseIds", java.util.List.of(exerciseId)));
        String routineResponse = mockMvc.perform(post("/api/people/" + personIdA + "/routines")
                        .header("Authorization", "Bearer " + tokenA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(routineBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long routineId = objectMapper.readTree(routineResponse).get("id").asLong();

        // Account B targeting Account A's own person id as a copy target must 404 --
        // B has no access to A's routine OR A's person id.
        String copyBody = objectMapper.writeValueAsString(Map.of(
                "targetPersonIds", java.util.List.of(personIdA)));
        mockMvc.perform(post("/api/people/" + personIdB + "/routines/" + routineId + "/copy")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(copyBody))
                .andExpect(status().isNotFound());

        // Add a second person to Account B and mix a valid B target with A's person id --
        // the whole call must roll back, so the valid target must not receive a partial copy.
        String addPersonBody = objectMapper.writeValueAsString(Map.of("name", "Blair's Kid"));
        String addPersonResponse = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(addPersonBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long personIdBKid = objectMapper.readTree(addPersonResponse).get("id").asLong();

        String routineBBody = objectMapper.writeValueAsString(Map.of(
                "name", "Account B Routine", "exerciseIds", java.util.List.of(exerciseId)));
        String routineBResponse = mockMvc.perform(post("/api/people/" + personIdB + "/routines")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(routineBBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long routineBId = objectMapper.readTree(routineBResponse).get("id").asLong();

        String mixedCopyBody = objectMapper.writeValueAsString(Map.of(
                "targetPersonIds", java.util.List.of(personIdBKid, personIdA)));
        mockMvc.perform(post("/api/people/" + personIdB + "/routines/" + routineBId + "/copy")
                        .header("Authorization", "Bearer " + tokenB)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mixedCopyBody))
                .andExpect(status().isNotFound());

        String kidListResponse = mockMvc.perform(get("/api/people/" + personIdBKid + "/routines")
                        .header("Authorization", "Bearer " + tokenB))
                .andReturn().getResponse().getContentAsString();
        org.junit.jupiter.api.Assertions.assertEquals(0, objectMapper.readTree(kidListResponse).size());
    }
}
