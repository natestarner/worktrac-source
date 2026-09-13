package com.worktrac.backend;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
class RoutineControllerTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, RoutineControllerTest.class);
    }

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

    private String token;
    private long personId;
    private List<Long> exerciseIds;

    @BeforeEach
    void setUp() throws Exception {
        String email = "routines-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
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

    // A routine may walk you through the same exercise more than once (bench, row, bench) --
    // nothing in the schema or the service ever forbade it, but nothing tested it either, so
    // "there happens to be no unique index on (routine_id, exercise_id)" was an accident waiting
    // to be tidied away. sort_order is assigned by list position in RoutineService#attachExercises,
    // so each occupied position is its own row.
    @Test
    void routineKeepsTheSameExerciseAtEveryPositionItAppearsIn() throws Exception {
        List<Long> cycling = List.of(exerciseIds.get(0), exerciseIds.get(1), exerciseIds.get(0));

        String createBody = objectMapper.writeValueAsString(Map.of("name", "Cycle", "exerciseIds", cycling));
        String createResponse = mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode created = objectMapper.readTree(createResponse);
        long routineId = created.get("id").asLong();

        assertEquals(3, created.get("exercises").size());
        assertEquals(exerciseIds.get(0), created.get("exercises").get(0).get("exerciseId").asLong());
        assertEquals(exerciseIds.get(1), created.get("exercises").get(1).get("exerciseId").asLong());
        assertEquals(exerciseIds.get(0), created.get("exercises").get(2).get("exerciseId").asLong());

        // Re-read rather than trusting the create response: @OrderBy("sortOrder ASC") is what has
        // to hold, and only a fresh load actually exercises it.
        String listResponse = mockMvc.perform(get("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        JsonNode reloaded = objectMapper.readTree(listResponse).get(0).get("exercises");
        assertEquals(3, reloaded.size());
        assertEquals(exerciseIds.get(0), reloaded.get(0).get("exerciseId").asLong());
        assertEquals(exerciseIds.get(1), reloaded.get(1).get("exerciseId").asLong());
        assertEquals(exerciseIds.get(0), reloaded.get(2).get("exerciseId").asLong());

        // update() clears and re-applies, so dropping one copy must leave the other -- and the
        // repeated auto-favorite (RoutineService#favorite runs per occurrence) must stay a no-op.
        String updateBody = objectMapper.writeValueAsString(
                Map.of("name", "Cycle", "exerciseIds", List.of(exerciseIds.get(0), exerciseIds.get(1))));
        String updateResponse = mockMvc.perform(put("/api/people/" + personId + "/routines/" + routineId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals(2, objectMapper.readTree(updateResponse).get("exercises").size());
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

    // ---- Ordering (V61/V62 routines.sort_order) --------------------------------------------
    //
    // The Log picker shows only the first few routines, so which ones those are is now a
    // preference the person sets rather than an accident of which they built first.

    private long createRoutine(String name) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name, "exerciseIds", exerciseIds));
        String response = mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private List<String> routineNames(long forPersonId) throws Exception {
        String response = mockMvc.perform(get("/api/people/" + forPersonId + "/routines")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> names = new ArrayList<>();
        objectMapper.readTree(response).forEach(node -> names.add(node.get("name").asText()));
        return names;
    }

    // A new routine appends. Listing used to be created_at ASC, which produced the same answer by
    // accident -- this pins it against the sort_order the reorder endpoint writes.
    @Test
    void newRoutinesAppendToTheEndOfThePersonsList() throws Exception {
        createRoutine("First");
        createRoutine("Second");
        createRoutine("Third");

        assertEquals(List.of("First", "Second", "Third"), routineNames(personId));
    }

    @Test
    void reorderRewritesTheListAndSurvivesAReload() throws Exception {
        long first = createRoutine("First");
        long second = createRoutine("Second");
        long third = createRoutine("Third");

        String body = objectMapper.writeValueAsString(Map.of("routineIds", List.of(third, first, second)));
        String response = mockMvc.perform(put("/api/people/" + personId + "/routines/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        List<String> responseNames = new ArrayList<>();
        objectMapper.readTree(response).forEach(node -> responseNames.add(node.get("name").asText()));
        assertEquals(List.of("Third", "First", "Second"), responseNames);

        // Re-read rather than trusting the response: persisting sort_order is the point, and only
        // a fresh load exercises findByPerson_IdOrderBySortOrderAscIdAsc.
        assertEquals(List.of("Third", "First", "Second"), routineNames(personId));
        assertEquals(3, List.of(first, second, third).size());

        // Creating AFTER a reorder is the only case that can tell a real sort_order from the id
        // tiebreak in the ORDER BY. While the list is still in creation order, every assertion
        // above would pass just as happily against a column stuck at 0 -- ids ascend in the same
        // direction. Here they diverge: appended, "Fourth" is last; at 0 it would tie with
        // "Third" and the id tiebreak would sort it SECOND.
        createRoutine("Fourth");
        assertEquals(List.of("Third", "First", "Second", "Fourth"), routineNames(personId));
    }

    // The list has to name every routine exactly once. A partial or duplicated list has no correct
    // interpretation -- the omitted ones would keep positions that now collide -- so it is refused
    // rather than silently renumbered around.
    @Test
    void reorderRefusesAListThatDoesNotMatchThePersonsRoutines() throws Exception {
        long first = createRoutine("First");
        createRoutine("Second");

        String partial = objectMapper.writeValueAsString(Map.of("routineIds", List.of(first)));
        mockMvc.perform(put("/api/people/" + personId + "/routines/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(partial))
                .andExpect(status().isBadRequest());

        String duplicated = objectMapper.writeValueAsString(Map.of("routineIds", List.of(first, first)));
        mockMvc.perform(put("/api/people/" + personId + "/routines/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(duplicated))
                .andExpect(status().isBadRequest());

        // Refused means unchanged, not partially applied.
        assertEquals(List.of("First", "Second"), routineNames(personId));
    }

    // Per-person separation, the household's core invariant: one person's routine id must not be
    // placeable into another person's ordering, even within the same account.
    @Test
    void reorderCannotPullInAnotherPersonsRoutine() throws Exception {
        long mine = createRoutine("Mine");
        long person2 = addPerson("Sam");

        String otherBody = objectMapper.writeValueAsString(Map.of("name", "Theirs", "exerciseIds", exerciseIds));
        String otherResponse = mockMvc.perform(post("/api/people/" + person2 + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(otherBody))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        long theirs = objectMapper.readTree(otherResponse).get("id").asLong();

        String body = objectMapper.writeValueAsString(Map.of("routineIds", List.of(theirs, mine)));
        mockMvc.perform(put("/api/people/" + personId + "/routines/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());

        assertEquals(List.of("Mine"), routineNames(personId));
        assertEquals(List.of("Theirs"), routineNames(person2));
    }

    // A copy arrives at the end of the list it is arriving IN, not at the source's position. Easy
    // to miss, because copy() builds the Routine directly rather than going through create().
    @Test
    void copiedRoutineLandsAtTheEndOfTheTargetsOwnList() throws Exception {
        long person2 = addPerson("Sam");
        long ownA = createRoutineFor(person2, "Sams A");
        long ownB = createRoutineFor(person2, "Sams B");

        // Put the target's list into an order the ids alone would not produce, so that a copy
        // which forgot to assign sort_order (landing at 0) sorts differently from one that
        // appended -- without this the id tiebreak makes both look identical.
        String reorderBody = objectMapper.writeValueAsString(Map.of("routineIds", List.of(ownB, ownA)));
        mockMvc.perform(put("/api/people/" + person2 + "/routines/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reorderBody))
                .andExpect(status().isOk());
        assertEquals(List.of("Sams B", "Sams A"), routineNames(person2));

        long source = createRoutine("Shared");
        String copyBody = objectMapper.writeValueAsString(Map.of("targetPersonIds", List.of(person2)));
        mockMvc.perform(post("/api/people/" + personId + "/routines/" + source + "/copy")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(copyBody))
                .andExpect(status().isOk());

        // Appended. At sort_order 0 it would tie with "Sams B" and the id tiebreak would place it
        // SECOND, not last.
        assertEquals(List.of("Sams B", "Sams A", "Shared"), routineNames(person2));
    }

    private long createRoutineFor(long forPersonId, String name) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("name", name, "exerciseIds", exerciseIds));
        String response = mockMvc.perform(post("/api/people/" + forPersonId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }
}
