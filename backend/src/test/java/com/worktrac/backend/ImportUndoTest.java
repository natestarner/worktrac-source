package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.support.BillingTestSupport;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;

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

// Taking an import back out again -- what it removes, what it deliberately leaves, and above all
// that it can only ever reach one person's data.
@AutoConfigureMockMvc
class ImportUndoTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ImportUndoTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private WorkoutSetRepository workoutSetRepository;

    @Autowired
    private TransactionTemplate transactionTemplate;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "undo-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();
        // Importing is a Pro feature. These tests are about the import itself, so the plan is
        // stated out loud rather than left as an assumption the gate would now break.
        BillingTestSupport.makePro(subscriptionRepository, registerJson.get("account").get("id").asLong());
    }

    // ── What undo does ─────────────────────────────────────────────────────────────────────────

    @Test
    void undoRemovesTheSetsAndWorkoutsTheImportCreated() throws Exception {
        JsonNode imported = commitImport(personId, """
                Exercise,Date,Time,Reps,Session Note
                Barbell Bench Press,2026-08-20,09:00:00,8,Felt strong
                Pull-up,2026-08-21,09:00:00,6,
                """);
        assertEquals(2, imported.get("setCount").asInt());
        assertEquals(2, historySessions().size());

        long batchId = imported.get("batchId").asLong();
        undo(personId, batchId).andExpect(status().isOk());

        assertEquals(0, historySessions().size(), "both imported workouts are gone");
        assertTrue(exportCsv(personId).split("\n").length == 1, "nothing but the header is left");
    }

    @Test
    void undoLeavesAWorkoutItOnlyAddedTo() throws Exception {
        // A real workout, exported, one set removed, then re-imported -- so the import appends to
        // a session that already existed rather than creating one.
        long bench = createExercise("Barbell Bench Press");
        logLiveSet(bench, 135, 8);
        JsonNode second = logLiveSet(bench, 145, 6);
        String csv = exportCsv(personId);

        long setId = second.get("set").get("id").asLong();
        mockMvc.perform(delete("/api/sets/" + setId).header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        JsonNode imported = commitImport(personId, csv);
        assertEquals(1, imported.get("setCount").asInt());
        assertEquals(1, historySessions().size());

        undo(personId, imported.get("batchId").asLong()).andExpect(status().isOk());

        assertEquals(1, historySessions().size(),
                "the workout survives -- the import added to it, it did not create it");
        assertEquals(1, historySessions().get(0).get("entries").get(0).get("sets").size(),
                "only the row the import added is gone");
    }

    @Test
    void undoLeavesTheExercisesTagsAndNotesTheImportCreated() throws Exception {
        JsonNode imported = commitImport(personId, """
                Exercise,Date,Reps,Favorite,Exercise Note,Tags
                Neck Curl,2026-08-20,8,Yes,Go slow,Neck
                """);
        undo(personId, imported.get("batchId").asLong()).andExpect(status().isOk());

        // The exercise stays in the person's picker with its personalization intact: those are
        // additive and shared, and may have been built on since. The confirm dialog says so.
        String personExercises = mockMvc.perform(get("/api/people/" + personId + "/exercises")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode rows = objectMapper.readTree(personExercises);
        JsonNode neckCurl = null;
        for (JsonNode row : rows) {
            if ("Neck Curl".equals(row.get("name").asText())) {
                neckCurl = row;
            }
        }
        assertTrue(neckCurl != null, "the exercise the import created is still there: " + personExercises);
        assertEquals("Go slow", neckCurl.get("note").asText());
        assertTrue(neckCurl.get("isFavorite").asBoolean());
    }

    @Test
    void undoIsRecordedAndIsSafeToRepeat() throws Exception {
        JsonNode imported = commitImport(personId, """
                Exercise,Date,Reps
                Barbell Bench Press,2026-08-20,8
                """);
        long batchId = imported.get("batchId").asLong();

        undo(personId, batchId).andExpect(status().isOk());
        // A double-tap is not a failure: the rows are gone either way.
        undo(personId, batchId).andExpect(status().isOk());

        JsonNode batches = listImports(personId);
        assertEquals(1, batches.size(), "the batch stays as an audit trail rather than vanishing");
        assertFalse(batches.get(0).get("undoneAt").isNull(), "and it is marked undone");
    }

    @Test
    void importUndoAndReimportRestoresExactlyWhatWasThere() throws Exception {
        long bench = createExercise("Barbell Bench Press");
        logLiveSet(bench, 135, 8);
        String original = exportCsv(personId);

        long other = createPerson("Ethan");
        JsonNode imported = commitImport(other, original);
        undo(other, imported.get("batchId").asLong()).andExpect(status().isOk());

        JsonNode again = commitImport(other, original);
        assertEquals(1, again.get("setCount").asInt(),
                "after an undo the rows are genuinely gone, so nothing reads as a duplicate");
        assertEquals(0, again.get("skippedDuplicateCount").asInt());
    }

    // ── Scope: undo must never reach another person or account ─────────────────────────────────

    // The batch id alone is never the scope of a delete. "Every row stamped with this batch belongs
    // to this person" is an app-layer invariant that nothing in the schema enforces, so this test
    // violates it deliberately -- stamping a second person's set with the first person's batch --
    // and requires the delete to refuse to touch it anyway. Remove the person predicate from
    // WorkoutSetRepository.deleteByImportBatchIdForPerson and this fails.
    @Test
    void undoCannotDeleteAnotherPersonsSetEvenWhenItCarriesTheSameBatchStamp() throws Exception {
        JsonNode imported = commitImport(personId, """
                Exercise,Date,Reps
                Barbell Bench Press,2026-08-20,8
                """);
        long batchId = imported.get("batchId").asLong();

        long sibling = createPerson("Ethan");
        long bench = createExercise("Barbell Bench Press");
        logLiveSetFor(sibling, bench, 95, 10);

        List<WorkoutSet> siblingSets = workoutSetRepository.findByPerson_IdOrderByCreatedAtAscIdAsc(sibling);
        assertEquals(1, siblingSets.size());
        long siblingSetId = siblingSets.get(0).getId();

        // Forge the invariant the delete is not allowed to trust.
        transactionTemplate.executeWithoutResult(status -> {
            WorkoutSet set = workoutSetRepository.findById(siblingSetId).orElseThrow();
            set.setImportBatchId(batchId);
            workoutSetRepository.save(set);
        });

        undo(personId, batchId).andExpect(status().isOk());

        assertTrue(workoutSetRepository.findById(siblingSetId).isPresent(),
                "a set belonging to another person must survive an undo, batch stamp or not");
    }

    @Test
    void undoingAnotherAccountsBatchIsANotFoundAndDeletesNothing() throws Exception {
        JsonNode imported = commitImport(personId, """
                Exercise,Date,Reps
                Barbell Bench Press,2026-08-20,8
                """);
        long batchId = imported.get("batchId").asLong();

        String otherEmail = "undo-other-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode other = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, otherEmail, "Stranger");
        String strangerToken = other.get("token").asText();
        long strangerPerson = other.get("person").get("id").asLong();

        // Both shapes of the attack: the stranger's own person id with our batch, and our person
        // id with our batch but their token.
        mockMvc.perform(delete("/api/people/" + strangerPerson + "/imports/" + batchId)
                        .header("Authorization", "Bearer " + strangerToken))
                .andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/people/" + personId + "/imports/" + batchId)
                        .header("Authorization", "Bearer " + strangerToken))
                .andExpect(status().isNotFound());

        // The 404 must come BEFORE anything is deleted -- an endpoint that errors after acting is
        // exactly what this asserts against.
        assertEquals(1, historySessions().size(), "the import is still there");
        assertTrue(listImports(personId).get(0).get("undoneAt").isNull(), "and was not marked undone");
    }

    @Test
    void oneImportHistoryIsNotVisibleOnAnotherPerson() throws Exception {
        commitImport(personId, """
                Exercise,Date,Reps
                Barbell Bench Press,2026-08-20,8
                """);
        long sibling = createPerson("Ethan");
        assertEquals(0, listImports(sibling).size(),
                "imports are listed per person, never per account");
        assertEquals(1, listImports(personId).size());
    }

    // ── Helpers ────────────────────────────────────────────────────────────────────────────────

    private org.springframework.test.web.servlet.ResultActions undo(long person, long batchId) throws Exception {
        return mockMvc.perform(delete("/api/people/" + person + "/imports/" + batchId)
                .header("Authorization", "Bearer " + token));
    }

    private JsonNode listImports(long person) throws Exception {
        String response = mockMvc.perform(get("/api/people/" + person + "/imports")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode commitImport(long targetPersonId, String csv) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + targetPersonId + "/import")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("csv", csv, "filename", "workouts.csv"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private String exportCsv(long targetPersonId) throws Exception {
        return mockMvc.perform(get("/api/people/" + targetPersonId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private JsonNode historySessions() throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private long createPerson(String name) throws Exception {
        String response = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private long createExercise(String name) throws Exception {
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private JsonNode logLiveSet(long exerciseId, double weight, int reps) throws Exception {
        return logLiveSetFor(personId, exerciseId, weight, reps);
    }

    private JsonNode logLiveSetFor(long person, long exerciseId, double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps));
        String response = mockMvc.perform(post("/api/people/" + person + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }
}
