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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class RoutineControllerTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private List<Long> exerciseIds;

    @BeforeEach
    void setUp() throws Exception {
        String email = "routines-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
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
        JsonNode exercises = objectMapper.readTree(exercisesResponse);
        exerciseIds = List.of(exercises.get(0).get("id").asLong(), exercises.get(1).get("id").asLong());
    }

    @Test
    void createStartAndReorderRoutine() throws Exception {
        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exerciseIds", exerciseIds));
        String createResponse = mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode created = objectMapper.readTree(createResponse);
        long routineId = created.get("id").asLong();
        assertEquals(2, created.get("exercises").size());
        assertEquals(exerciseIds.get(0), created.get("exercises").get(0).get("exerciseId").asLong());

        // reorder: reverse the exercise order
        List<Long> reversed = List.of(exerciseIds.get(1), exerciseIds.get(0));
        String updateBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exerciseIds", reversed));
        String updateResponse = mockMvc.perform(put("/api/people/" + personId + "/routines/" + routineId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode updated = objectMapper.readTree(updateResponse);
        assertEquals(exerciseIds.get(1), updated.get("exercises").get(0).get("exerciseId").asLong());

        mockMvc.perform(delete("/api/people/" + personId + "/routines/" + routineId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        String listResponse = mockMvc.perform(get("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        assertEquals(0, objectMapper.readTree(listResponse).size());
    }

    private long addPerson(String name) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name));
        String response = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    @Test
    void copyRoutineToMultipleTargets() throws Exception {
        long person2 = addPerson("Sam");
        long person3 = addPerson("Jordan");

        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exerciseIds", exerciseIds));
        String createResponse = mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long routineId = objectMapper.readTree(createResponse).get("id").asLong();

        String copyBody = objectMapper.writeValueAsString(Map.of("targetPersonIds", List.of(person2, person3)));
        String copyResponse = mockMvc.perform(post("/api/people/" + personId + "/routines/" + routineId + "/copy")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(copyBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode copies = objectMapper.readTree(copyResponse);
        assertEquals(2, copies.size());
        assertEquals("Push Day", copies.get(0).get("name").asText());
        assertEquals(2, copies.get(0).get("exercises").size());

        String person2List = mockMvc.perform(get("/api/people/" + person2 + "/routines")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        assertEquals(1, objectMapper.readTree(person2List).size());

        String person3List = mockMvc.perform(get("/api/people/" + person3 + "/routines")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        assertEquals(1, objectMapper.readTree(person3List).size());

        // Independence: deleting the original doesn't touch the copies.
        mockMvc.perform(delete("/api/people/" + personId + "/routines/" + routineId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());
        String person2ListAfterDelete = mockMvc.perform(get("/api/people/" + person2 + "/routines")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        assertEquals(1, objectMapper.readTree(person2ListAfterDelete).size());
    }

    @Test
    void copyRoutineFailsWithEmptyTargetList() throws Exception {
        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exerciseIds", exerciseIds));
        String createResponse = mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long routineId = objectMapper.readTree(createResponse).get("id").asLong();

        String copyBody = objectMapper.writeValueAsString(Map.of("targetPersonIds", List.of()));
        mockMvc.perform(post("/api/people/" + personId + "/routines/" + routineId + "/copy")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(copyBody))
                .andExpect(status().isBadRequest());
    }

    @Test
    void copyRoutineFailsWhenCallerDoesNotOwnSourceRoutine() throws Exception {
        long person2 = addPerson("Sam");

        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exerciseIds", exerciseIds));
        String createResponse = mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long routineId = objectMapper.readTree(createResponse).get("id").asLong();

        // Routine belongs to personId, not person2 -- copy via person2's path must 404.
        String copyBody = objectMapper.writeValueAsString(Map.of("targetPersonIds", List.of(person2)));
        mockMvc.perform(post("/api/people/" + person2 + "/routines/" + routineId + "/copy")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(copyBody))
                .andExpect(status().isNotFound());
    }
}
