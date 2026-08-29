package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.support.BillingTestSupport;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Reading an export back in. The anchor test here is the round trip: export one person, import
// into another, export that one, and require the two files to be identical. Everything else in
// this class is a specific rule that round trip alone wouldn't pin down.
@AutoConfigureMockMvc
class CsvImportControllerTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, CsvImportControllerTest.class);
    }

    // Same reasoning as CsvExportControllerTest's: a MutableClock keeps "two sets N seconds apart"
    // exact, and keeps advances inside the 8-hour AUTOCLOSE window.
    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private MutableClock clock;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "import-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();
        // Importing is a Pro feature. These tests are about the import itself, so the plan is
        // stated out loud rather than left as an assumption the gate would now break.
        BillingTestSupport.makePro(subscriptionRepository, registerJson.get("account").get("id").asLong());
    }

    // ── The anchor ─────────────────────────────────────────────────────────────────────────────

    @Test
    void exportingOnePersonAndImportingIntoAnotherReproducesTheFileExactly() throws Exception {
        long bench = createExercise("Barbell Bench Press");
        long plank = createDurationExercise("Wall Sit");

        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + bench + "/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("tags", List.of("Push", "Chest")))))
                .andExpect(status().isOk());
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + bench + "/note")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("note", "Elbows tucked"))))
                .andExpect(status().isOk());

        logLiveSet(bench, 135, 8);
        clock.advance(Duration.ofSeconds(90));
        logLiveSet(bench, 135, 8);
        logHold(plank, 0, 65);
        saveSessionNote(bench, "Felt strong");

        String source = exportCsv(personId);
        long otherPerson = createPerson("Ethan");

        JsonNode result = commitImport(otherPerson, source);
        assertEquals(3, result.get("setCount").asInt());
        assertEquals(0, result.get("skippedDuplicateCount").asInt());
        assertTrue(result.get("rowErrors").isEmpty(), "a file this app wrote must import without errors");

        String reExported = exportCsv(otherPerson);
        assertEquals(source, reExported,
                "an export, imported and exported again, must be byte-identical -- import is the inverse of export");
    }

    // ── Duplicates ─────────────────────────────────────────────────────────────────────────────

    @Test
    void reimportingTheSameFileIntoTheSamePersonAddsNothing() throws Exception {
        long bench = createExercise("Barbell Bench Press");
        logLiveSet(bench, 135, 8);
        clock.advance(Duration.ofSeconds(60));
        logLiveSet(bench, 145, 6);

        String csv = exportCsv(personId);
        JsonNode result = commitImport(personId, csv);

        assertEquals(0, result.get("setCount").asInt(), "every row is already there");
        assertEquals(2, result.get("skippedDuplicateCount").asInt());
        assertTrue(result.get("batchId").isNull(),
                "a commit that creates nothing must not leave a phantom entry in the import history");
        assertEquals(csv, exportCsv(personId), "the person's data is untouched");
    }

    @Test
    void aDeletedSetComesBackAndJoinsTheWorkoutItCameFrom() throws Exception {
        long bench = createExercise("Barbell Bench Press");
        logLiveSet(bench, 135, 8);
        clock.advance(Duration.ofSeconds(60));
        JsonNode second = logLiveSet(bench, 145, 6);
        String csv = exportCsv(personId);

        long setId = second.get("set").get("id").asLong();
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/sets/" + setId).header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        JsonNode result = commitImport(personId, csv);
        assertEquals(1, result.get("setCount").asInt(), "only the deleted row comes back");
        assertEquals(1, result.get("skippedDuplicateCount").asInt());
        assertEquals(1, historySessions().size(), "still one workout, not two");
        assertEquals(csv, exportCsv(personId), "the file is restored exactly");
    }

    @Test
    void twoIdenticalSetsSharingATimestampAreCountedNotCollapsed() throws Exception {
        long bench = createExercise("Barbell Bench Press");
        // Both sets land on the same clock tick, so they are indistinguishable by identity alone.
        logLiveSet(bench, 135, 8);
        logLiveSet(bench, 135, 8);
        String csv = exportCsv(personId);

        long otherPerson = createPerson("Ethan");
        // Import once: both rows are new.
        assertEquals(2, commitImport(otherPerson, csv).get("setCount").asInt());
        // Import again: both are now present, and neither is added a second time.
        JsonNode second = commitImport(otherPerson, csv);
        assertEquals(0, second.get("setCount").asInt());
        assertEquals(2, second.get("skippedDuplicateCount").asInt(),
                "duplicate matching counts occurrences -- one existing row must not mask two incoming ones");
    }

    // ── The column contract ────────────────────────────────────────────────────────────────────

    @Test
    void aThreeColumnSpreadsheetImportsWithEveryDefaultReported() throws Exception {
        String csv = """
                Exercise,Date,Reps
                Barbell Bench Press,2026-08-20,8
                Barbell Bench Press,2026-08-20,8
                Pull-up,2026-08-21,6
                """;

        JsonNode result = commitImport(personId, csv);
        assertEquals(3, result.get("setCount").asInt());
        assertEquals(2, result.get("sessionCount").asInt(), "one workout per date");

        List<String> defaults = stringList(result.get("appliedDefaults"));
        assertTrue(defaults.stream().anyMatch(d -> d.contains("No Time column")), defaults.toString());
        assertTrue(defaults.stream().anyMatch(d -> d.contains("No Weight column")), defaults.toString());
        assertTrue(defaults.stream().anyMatch(d -> d.contains("No Unit column")), defaults.toString());
        assertTrue(defaults.stream().anyMatch(d -> d.contains("No Session Start column")), defaults.toString());
        assertTrue(defaults.stream().anyMatch(d -> d.contains("No Session Type column")), defaults.toString());

        String[] lines = exportCsv(personId).split("\n");
        assertEquals(4, lines.length, "header plus three sets");
        // Noon, not midnight: History renders in local time, and a UTC-midnight set would show up
        // on the previous day for anyone west of Greenwich.
        assertTrue(lines[1].startsWith("2026-08-20,12:00:00,"), lines[1]);
        assertTrue(lines[1].contains(",0.00,lb,8,"), "absent weight is bodyweight in the account's unit: " + lines[1]);
        assertTrue(lines[1].contains(",Logged Later,"), "no Session Type column means logged later: " + lines[1]);
        assertTrue(lines[2].startsWith("2026-08-20,12:00:01,"),
                "rows sharing a defaulted day stay in file order: " + lines[2]);
    }

    @Test
    void eachRequiredColumnIsNamedWhenItIsMissing() throws Exception {
        assertImportRejected("Date,Reps\n2026-08-20,8\n", "Exercise");
        assertImportRejected("Exercise,Reps\nBench,8\n", "Date");
        assertImportRejected("Exercise,Date\nBench,2026-08-20\n", "Reps or Duration");
    }

    @Test
    void aDuplicatedHeaderIsRefusedRatherThanGuessed() throws Exception {
        assertImportRejected("Exercise,Date,Reps,Reps\nBench,2026-08-20,8,9\n", "two columns called");
    }

    @Test
    void aBlankCellTakesTheSameDefaultAsAMissingColumn() throws Exception {
        String csv = """
                Exercise,Date,Time,Weight,Unit,Reps
                Barbell Bench Press,2026-08-20,,,,8
                """;
        JsonNode result = commitImport(personId, csv);
        assertEquals(1, result.get("setCount").asInt());
        assertTrue(result.get("rowErrors").isEmpty(), "a blank optional cell is not an error: " + result.get("rowErrors"));

        String row = exportCsv(personId).split("\n")[1];
        assertTrue(row.startsWith("2026-08-20,12:00:00,"), row);
        assertTrue(row.contains(",0.00,lb,8,"), row);
    }

    // ── Row-level rejection ────────────────────────────────────────────────────────────────────

    @Test
    void badRowsAreReportedByLineAndTheGoodOnesStillImport() throws Exception {
        String csv = """
                Exercise,Date,Weight,Unit,Reps,Duration (sec)
                Barbell Bench Press,2026-08-20,135,lb,8,
                Barbell Bench Press,not-a-date,135,lb,8,
                Barbell Bench Press,2026-08-20,135,stone,8,
                Barbell Bench Press,2026-08-20,135,lb,8,30
                Barbell Bench Press,2026-08-20,-5,lb,8,
                Barbell Bench Press,2026-08-20,135,lb,,
                """;

        JsonNode result = commitImport(personId, csv);
        assertEquals(1, result.get("setCount").asInt(), "only the first row is usable");

        JsonNode errors = result.get("rowErrors");
        assertEquals(5, errors.size());
        assertEquals(3, errors.get(0).get("line").asInt(), "line numbers count the header, like a spreadsheet does");
        assertTrue(errors.get(0).get("message").asText().contains("date"), errors.get(0).toString());
        assertTrue(errors.get(1).get("message").asText().contains("lb or kg"), errors.get(1).toString());
        assertTrue(errors.get(2).get("message").asText().contains("both reps and a duration"), errors.get(2).toString());
        assertTrue(errors.get(3).get("message").asText().contains("negative"), errors.get(3).toString());
        assertTrue(errors.get(4).get("message").asText().contains("neither reps nor a duration"), errors.get(4).toString());
    }

    @Test
    void anExerciseRecordedBothWaysInOneFileIsRefusedRatherThanGuessed() throws Exception {
        String csv = """
                Exercise,Date,Reps,Duration (sec)
                Plank,2026-08-20,,60
                Plank,2026-08-20,10,
                """;
        JsonNode result = commitImport(personId, csv);
        assertEquals(0, result.get("setCount").asInt());
        assertTrue(result.get("rowErrors").get(0).get("message").asText()
                .contains("both reps and durations"), result.get("rowErrors").toString());
    }

    @Test
    void aFileThatContradictsHowAnExerciseIsAlreadyTrackedIsRefused() throws Exception {
        createDurationExercise("Wall Sit");
        String csv = """
                Exercise,Date,Reps
                Wall Sit,2026-08-20,10
                """;
        JsonNode result = commitImport(personId, csv);
        assertEquals(0, result.get("setCount").asInt());
        assertTrue(result.get("rowErrors").get(0).get("message").asText()
                .contains("already tracked in seconds"), result.get("rowErrors").toString());
    }

    // ── Values a naive importer would lose ─────────────────────────────────────────────────────

    @Test
    void restSecondsAndAPerRowUnitSurviveTheRoundTrip() throws Exception {
        String csv = """
                Exercise,Date,Time,Session Start,Session Type,Weight,Unit,Reps,Rest (sec)
                Barbell Bench Press,2026-08-20,09:00:00,2026-08-20 09:00:00,Live,60,kg,8,
                Barbell Bench Press,2026-08-20,09:02:30,2026-08-20 09:00:00,Live,60,kg,8,150
                """;
        JsonNode result = commitImport(personId, csv);
        assertEquals(2, result.get("setCount").asInt());

        String[] lines = exportCsv(personId).split("\n");
        // Rest is restored verbatim, not recomputed: it records what actually happened.
        assertTrue(lines[1].endsWith(",kg,8,,,76.0"), lines[1]);
        assertTrue(lines[2].contains(",kg,8,,150,"), "rest_seconds is restored as recorded: " + lines[2]);
        // kg survives on an account whose default is lb.
        assertTrue(lines[1].contains(",kg,"), lines[1]);
        assertTrue(lines[1].contains(",Live,"), "Session Type round-trips: " + lines[1]);
    }

    @Test
    void anImportedWorkoutNeverBecomesTheLiveSession() throws Exception {
        commitImport(personId, """
                Exercise,Date,Reps
                Barbell Bench Press,2019-03-04,8
                """);

        mockMvc.perform(get("/api/people/" + personId + "/sessions/live")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        // And a set logged now opens a fresh workout rather than landing in the 2019 one.
        long bench = createExercise("Barbell Bench Press");
        logLiveSet(bench, 135, 8);
        assertEquals(2, historySessions().size(),
                "the imported workout is closed, so today's set starts its own session");
    }

    @Test
    void sessionStartGroupsTwoWorkoutsOnOneDaySeparately() throws Exception {
        String csv = """
                Exercise,Date,Time,Session Start,Reps
                Barbell Bench Press,2026-08-20,09:00:00,2026-08-20 09:00:00,8
                Pull-up,2026-08-20,17:30:00,2026-08-20 17:30:00,6
                """;
        assertEquals(2, commitImport(personId, csv).get("sessionCount").asInt());
        assertEquals(2, historySessions().size());
    }

    @Test
    void withoutSessionStartEverythingOnADateIsOneWorkout() throws Exception {
        String csv = """
                Exercise,Date,Time,Reps
                Barbell Bench Press,2026-08-20,09:00:00,8
                Pull-up,2026-08-20,17:30:00,6
                Pull-up,2026-08-21,08:00:00,6
                """;
        assertEquals(2, commitImport(personId, csv).get("sessionCount").asInt());
        assertEquals(2, historySessions().size());
    }

    @Test
    void spreadsheetFlavouredDatesAndTimesParseToTheSameInstants() throws Exception {
        String csv = """
                Exercise,Date,Time,Reps
                Barbell Bench Press,8/20/2026,9:14:32 AM,8
                """;
        assertEquals(1, commitImport(personId, csv).get("setCount").asInt());
        assertTrue(exportCsv(personId).split("\n")[1].startsWith("2026-08-20,09:14:32,"),
                "an Excel round trip must not shift the instant");
    }

    // Regression: our own export always zero-pads the hour (CsvExportService's TIME_FMT is
    // "HH:mm:ss"), but a spreadsheet round trip commonly hands it back without the leading zero
    // while keeping minutes/seconds padded -- e.g. "1:50:18" rather than "01:50:18". These rows
    // used to be flatly rejected as "Couldn't read the time".
    @Test
    void aNonZeroPaddedTwentyFourHourTimeStillParses() throws Exception {
        String csv = """
                Exercise,Date,Time,Reps
                Barbell Bench Press,8/20/2026,1:50:18,8
                """;
        assertEquals(1, commitImport(personId, csv).get("setCount").asInt());
        assertTrue(exportCsv(personId).split("\n")[1].startsWith("2026-08-20,01:50:18,"),
                "a bare, non-zero-padded hour must still resolve to the right instant");
    }

    @Test
    void aFileWithABomAndCrlfStillReads() throws Exception {
        String csv = "﻿Exercise,Date,Reps\r\nBarbell Bench Press,2026-08-20,8\r\n";
        JsonNode result = commitImport(personId, csv);
        assertEquals(1, result.get("setCount").asInt(),
                "a BOM would otherwise become part of the first heading's name");
    }

    // ── Personalization ────────────────────────────────────────────────────────────────────────

    @Test
    void personalizationIsAddedWhereAbsentAndNeverOverwritten() throws Exception {
        long bench = createExercise("Barbell Bench Press");
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + bench + "/note")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("note", "Mine, written later"))))
                .andExpect(status().isOk());
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + bench + "/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("tags", List.of("Push")))))
                .andExpect(status().isOk());

        String csv = """
                Exercise,Date,Reps,Favorite,Exercise Note,Tags
                Barbell Bench Press,2026-08-20,8,Yes,From the file,Chest; Upper
                Pull-up,2026-08-20,6,No,Grip wide,Back
                """;
        JsonNode result = commitImport(personId, csv);

        assertEquals(1, result.get("notesApplied").asInt(), "only the exercise with no note gets one");
        assertEquals(1, result.get("notesSkipped").asInt(), "the existing note is left alone");
        assertEquals(1, result.get("favoritesApplied").asInt());
        assertEquals(3, result.get("tagsApplied").asInt(), "Chest and Upper on bench, Back on pull-up");

        JsonNode benchRow = personExercise(bench);
        assertEquals("Mine, written later", benchRow.get("note").asText(), "the person's own note wins");
        List<String> tags = stringList(benchRow.get("tags"), "name");
        assertTrue(tags.contains("Push"), "a tag the file didn't mention is never removed: " + tags);
        assertTrue(tags.contains("Chest") && tags.contains("Upper"), "the file's tags are added: " + tags);
    }

    @Test
    void aTagAlreadyInTheVocabularyIsReusedCaseInsensitively() throws Exception {
        long bench = createExercise("Barbell Bench Press");
        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + bench + "/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("tags", List.of("Chest")))))
                .andExpect(status().isOk());

        JsonNode result = commitImport(personId, """
                Exercise,Date,Reps,Tags
                Pull-up,2026-08-20,6,chest; Back
                """);

        List<String> newTags = stringList(result.get("newTagNames"));
        assertEquals(List.of("Back"), newTags, "\"chest\" already exists, so only Back is new to the account");

        String tagsResponse = mockMvc.perform(get("/api/tags").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        long chestCount = stringList(objectMapper.readTree(tagsResponse), "name").stream()
                .filter(n -> n.equalsIgnoreCase("chest")).count();
        assertEquals(1, chestCount, "no near-duplicate \"chest\" beside \"Chest\"");
    }

    @Test
    void aSessionNoteIsWrittenOnceAndNeverOverTheTop() throws Exception {
        String csv = """
                Exercise,Date,Session Start,Reps,Session Note
                Barbell Bench Press,2026-08-20,2026-08-20 09:00:00,8,From the file
                """;
        assertEquals(1, commitImport(personId, csv).get("sessionNotesApplied").asInt());
        assertTrue(exportCsv(personId).contains("From the file"));

        // Re-importing a file whose sets are all duplicates must not touch the note either.
        JsonNode second = commitImport(personId, csv);
        assertEquals(0, second.get("sessionNotesApplied").asInt());
    }

    // ── Ownership ──────────────────────────────────────────────────────────────────────────────

    @Test
    void importingIntoAnotherAccountsPersonIsANotFound() throws Exception {
        String otherEmail = "import-other-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode other = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, otherEmail, "Stranger");
        long strangerPerson = other.get("person").get("id").asLong();

        mockMvc.perform(post("/api/people/" + strangerPerson + "/import")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("csv", "Exercise,Date,Reps\nBench,2026-08-20,8\n", "filename", "x.csv"))))
                .andExpect(status().isNotFound());

        // And nothing was written to them.
        String strangerToken = other.get("token").asText();
        String history = mockMvc.perform(get("/api/people/" + strangerPerson + "/history")
                        .header("Authorization", "Bearer " + strangerToken))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(objectMapper.readTree(history).isEmpty(), "a refused import must not have written anything");
    }

    // ── Helpers ────────────────────────────────────────────────────────────────────────────────

    private JsonNode commitImport(long targetPersonId, String csv) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + targetPersonId + "/import")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("csv", csv, "filename", "workouts.csv"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private void assertImportRejected(String csv, String expectedFragment) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + personId + "/import/preview")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("csv", csv, "filename", "x.csv"))))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        assertTrue(response.contains(expectedFragment),
                "expected the message to name \"" + expectedFragment + "\", was: " + response);
    }

    private String exportCsv(long targetPersonId) throws Exception {
        return mockMvc.perform(get("/api/people/" + targetPersonId + "/export.csv")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private JsonNode historySessions() throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode personExercise(long exerciseId) throws Exception {
        String response = mockMvc.perform(get("/api/people/" + personId + "/exercises")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        for (JsonNode row : objectMapper.readTree(response)) {
            if (row.get("id").asLong() == exerciseId) {
                return row;
            }
        }
        throw new AssertionError("exercise " + exerciseId + " is not in the person's list");
    }

    private List<String> stringList(JsonNode array) {
        return java.util.stream.StreamSupport.stream(array.spliterator(), false).map(JsonNode::asText).toList();
    }

    private List<String> stringList(JsonNode array, String field) {
        return java.util.stream.StreamSupport.stream(array.spliterator(), false)
                .map(n -> n.get(field).asText()).toList();
    }

    private long createPerson(String name) throws Exception {
        String response = mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private long createExercise(String name) throws Exception {
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private long createDurationExercise(String name) throws Exception {
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", name, "trackingType", "duration"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private JsonNode logLiveSet(long exerciseId, double weight, int reps) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", weight, "reps", reps));
        String response = mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private void logHold(long exerciseId, double weight, int seconds) throws Exception {
        String body = objectMapper.writeValueAsString(
                Map.of("exerciseId", exerciseId, "weight", weight, "reps", 0, "durationSeconds", seconds));
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private void saveSessionNote(long exerciseId, String note) throws Exception {
        mockMvc.perform(put("/api/people/" + personId + "/live-exercise-notes")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "note", note))))
                .andExpect(status().isOk());
    }

    @Test
    void anEmptyFileIsRefusedWithSomethingReadable() throws Exception {
        assertImportRejected("", "empty");
    }
}
