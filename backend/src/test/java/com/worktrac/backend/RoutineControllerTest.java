package com.worktrac.backend;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
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

    /**
     * The routine request's exercise list, ids only.
     *
     * <p>RoutineRequest carries a prescribed target per exercise (V77), so a bare id list is no
     * longer the wire shape. Every test here is about ORDER and OWNERSHIP rather than targets, so
     * they send the no-target form -- which is also what a person building their own routine sends.
     */
    private static List<Map<String, Object>> asRequest(List<Long> ids) {
        return ids.stream().map(id -> Map.<String, Object>of("exerciseId", id)).toList();
    }

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
        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exercises", asRequest(exerciseIds)));
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
        String updateBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exercises", asRequest(reversed)));
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

        String createBody = objectMapper.writeValueAsString(Map.of("name", "Cycle", "exercises", asRequest(cycling)));
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
                Map.of("name", "Cycle", "exercises", asRequest(List.of(exerciseIds.get(0), exerciseIds.get(1)))));
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

        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exercises", asRequest(exerciseIds)));
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
        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exercises", asRequest(exerciseIds)));
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

        String createBody = objectMapper.writeValueAsString(Map.of("name", "Push Day", "exercises", asRequest(exerciseIds)));
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
        String body = objectMapper.writeValueAsString(Map.of("name", name, "exercises", asRequest(exerciseIds)));
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

        String otherBody = objectMapper.writeValueAsString(Map.of("name", "Theirs", "exercises", asRequest(exerciseIds)));
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
        String body = objectMapper.writeValueAsString(Map.of("name", name, "exercises", asRequest(exerciseIds)));
        String response = mockMvc.perform(post("/api/people/" + forPersonId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    /**
     * Programs: a routine assigned onto somebody else, carrying the numbers they are meant to hit.
     *
     * <p>Assignment is not a separate operation — it is {@code copy} landing on another person, and
     * these tests exist mostly to pin the two things that makes silent when wrong: the provenance
     * stamp, and whether the targets travelled.
     */
    @Nested
    @DisplayName("programs")
    class Programs {

        private long clientPersonId;

        @BeforeEach
        void addAClient() throws Exception {
            clientPersonId = objectMapper.readTree(mockMvc.perform(post("/api/people")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of("name", "Dana"))))
                    .andReturn().getResponse().getContentAsString())
                    .get("id").asLong();
        }

        private JsonNode createWithTarget() throws Exception {
            String body = objectMapper.writeValueAsString(Map.of(
                    "name", "Squat Day",
                    "exercises", List.of(
                            Map.of("exerciseId", exerciseIds.get(0),
                                    "targetWeight", 185, "targetReps", 5, "targetUnit", "lb"),
                            Map.of("exerciseId", exerciseIds.get(1)))));
            return objectMapper.readTree(mockMvc.perform(post("/api/people/" + personId + "/routines")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString());
        }

        private JsonNode routinesFor(long owningPersonId) throws Exception {
            return objectMapper.readTree(mockMvc.perform(get("/api/people/" + owningPersonId + "/routines")
                            .header("Authorization", "Bearer " + token))
                    .andReturn().getResponse().getContentAsString());
        }

        private JsonNode assignTo(long routineId, long targetPersonId) throws Exception {
            return objectMapper.readTree(mockMvc.perform(post(
                            "/api/people/" + personId + "/routines/" + routineId + "/copy")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(
                                    Map.of("targetPersonIds", List.of(targetPersonId)))))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString());
        }

        @Test
        void aTargetRoundTripsThroughCreate() throws Exception {
            JsonNode created = createWithTarget();

            JsonNode first = created.get("exercises").get(0);
            assertEquals(185, first.get("targetWeight").asInt());
            assertEquals(5, first.get("targetReps").asInt());
            assertEquals("lb", first.get("targetUnit").asText());

            // The second exercise carries no target, and "no target" is null rather than zero.
            assertTrue(created.get("exercises").get(1).get("targetWeight").isNull());
            assertTrue(created.get("exercises").get(1).get("targetReps").isNull());
        }

        // ⚠️ THE ONE THAT WOULD HAVE BEEN SILENT DATA LOSS. update() clears the routine's exercises
        // and rebuilds them from the request, so a request shape that could not carry a target used
        // to destroy every target whenever a trainer renamed the routine or dragged one exercise --
        // with the numbers simply gone the next time the client opened their program.
        @Test
        void aTargetSurvivesRenamingTheRoutine() throws Exception {
            long routineId = createWithTarget().get("id").asLong();

            String body = objectMapper.writeValueAsString(Map.of(
                    "name", "Squat Day (heavy)",
                    "exercises", List.of(
                            Map.of("exerciseId", exerciseIds.get(0),
                                    "targetWeight", 185, "targetReps", 5, "targetUnit", "lb"),
                            Map.of("exerciseId", exerciseIds.get(1)))));
            JsonNode updated = objectMapper.readTree(mockMvc.perform(
                            put("/api/people/" + personId + "/routines/" + routineId)
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString());

            assertEquals("Squat Day (heavy)", updated.get("name").asText());
            assertEquals(185, updated.get("exercises").get(0).get("targetWeight").asInt());
        }

        // Omitting a target means "no target", never "leave what was there". The request is the
        // whole truth about the routine, and a client that reads targets must send them back.
        @Test
        void omittingATargetClearsIt() throws Exception {
            long routineId = createWithTarget().get("id").asLong();

            String body = objectMapper.writeValueAsString(Map.of(
                    "name", "Squat Day",
                    "exercises", asRequest(exerciseIds)));
            JsonNode updated = objectMapper.readTree(mockMvc.perform(
                            put("/api/people/" + personId + "/routines/" + routineId)
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andReturn().getResponse().getContentAsString());

            assertTrue(updated.get("exercises").get(0).get("targetWeight").isNull());
        }

        @Test
        void assigningCarriesTheTargetsOntoTheClient() throws Exception {
            long routineId = createWithTarget().get("id").asLong();

            assignTo(routineId, clientPersonId);

            JsonNode assigned = routinesFor(clientPersonId).get(0);
            assertEquals(185, assigned.get("exercises").get(0).get("targetWeight").asInt());
            assertEquals("lb", assigned.get("exercises").get(0).get("targetUnit").asText());
        }

        // A template whose numbers did not travel would arrive as a bare list of exercise names,
        // which is the difference between assigning a program and sharing a checklist.
        @Test
        void assigningStampsWhoPutItThere() throws Exception {
            long routineId = createWithTarget().get("id").asLong();

            assignTo(routineId, clientPersonId);

            JsonNode assigned = routinesFor(clientPersonId).get(0);
            assertEquals("Nate", assigned.get("assignedByName").asText());
            assertTrue(assigned.get("assignedAt").isTextual());
        }

        // ⚠️ Copying your OWN routine is not an assignment. Stamping it would have somebody's own
        // Routines list claim a trainer put it there -- and on a family account, that is every
        // duplicate anybody has ever made.
        @Test
        void duplicatingYourOwnRoutineIsNotAnAssignment() throws Exception {
            long routineId = createWithTarget().get("id").asLong();

            assignTo(routineId, personId);

            JsonNode mine = routinesFor(personId);
            for (JsonNode routine : mine) {
                assertTrue(routine.get("assignedByName").isNull(), "a self-copy must name nobody");
                assertTrue(routine.get("assignedAt").isNull());
            }
        }

        // Every routine that existed before programs did, and every one a person builds for
        // themselves. Null must render as naming nobody rather than printing "null".
        @Test
        void aSelfMadeRoutineNamesNobody() throws Exception {
            JsonNode created = createWithTarget();

            assertTrue(created.get("assignedByName").isNull());
            assertTrue(created.get("assignedAt").isNull());
        }

        // A weight with no unit is not interpretable. The DB refuses the pairing outright
        // (CK_routine_exercises_target_unit); this is the client-facing half.
        @Test
        void refusesAWeightWithNoUnit() throws Exception {
            String body = objectMapper.writeValueAsString(Map.of(
                    "name", "Broken",
                    "exercises", List.of(Map.of("exerciseId", exerciseIds.get(0), "targetWeight", 185))));

            JsonNode created = objectMapper.readTree(mockMvc.perform(
                            post("/api/people/" + personId + "/routines")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString());

            // Dropped rather than rejected: a target is a convenience, and refusing the whole
            // routine over an unusable half of one would lose the routine as well.
            assertTrue(created.get("exercises").get(0).get("targetWeight").isNull());
        }

        @Test
        void refusesAZeroRepTarget() throws Exception {
            String body = objectMapper.writeValueAsString(Map.of(
                    "name", "Broken",
                    "exercises", List.of(Map.of("exerciseId", exerciseIds.get(0), "targetReps", 0))));

            mockMvc.perform(post("/api/people/" + personId + "/routines")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isBadRequest());
        }
    }

}
