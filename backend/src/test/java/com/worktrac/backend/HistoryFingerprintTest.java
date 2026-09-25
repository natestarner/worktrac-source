package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import com.worktrac.backend.workoutsession.HistoryEntryDto;
import com.worktrac.backend.workoutsession.HistoryFingerprints;
import com.worktrac.backend.workoutsession.HistorySessionDto;
import com.worktrac.backend.stats.SetSummaryDto;
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

import java.lang.reflect.RecordComponent;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The History sync trusts a month the client already holds for as long as its fingerprint is
// unchanged. So the one failure that matters here is a change that does NOT move the fingerprint:
// the device would keep showing the old month, with nothing to correct it until the daily full sync.
//
// Every write a person can make is driven through the real API below, and each test asserts both
// halves: the month it touched changed, and the months it did not touch did not (a fingerprint that
// changed on everything would pass the first half and make the sync pointless).
//
// ⚠️ If one of these starts failing after a change to History, do not loosen the assertion -- fold
// the new input into HistoryFingerprints.
@AutoConfigureMockMvc
class HistoryFingerprintTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HistoryFingerprintTest.class);
    }

    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private MutableClock clock;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private SubscriptionRepository subscriptionRepository;
    @Autowired private SubscriptionService subscriptionService;
    @Autowired private HistoryFingerprints historyFingerprints;
    @Autowired private org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long accountId;
    private long personId;
    private long exerciseId;

    private static final String MARCH = "2026-03";
    private static final String MAY = "2026-05";
    private static final String JUNE = "2026-06";

    @BeforeEach
    void setUp() throws Exception {
        clock.advance(Duration.between(clock.instant(), Instant.parse("2026-06-15T12:00:00Z")));

        String email = "fingerprint-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registration.get("token").asText();
        accountId = registration.get("account").get("id").asLong();
        personId = registration.get("person").get("id").asLong();
        setFullHistory(true);

        String exercises = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercises).get(0).get("id").asLong();
    }

    // ── Logging ──────────────────────────────────────────────────────────────────────────────

    @Test
    void loggingASetIntoAPastWorkoutChangesOnlyThatMonth() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();

        logSet(march, 105, 5);

        assertChangedExactly(before, snap(), MARCH);
    }

    @Test
    void everyLiveSetChangesTheCurrentMonth() throws Exception {
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);

        logLiveSet(exerciseId, 100, 5);
        Snapshot afterFirst = snap();
        assertTrue(afterFirst.fp().containsKey(JUNE), "the live workout's month appears with its first set");

        logLiveSet(exerciseId, 110, 5);
        assertChangedExactly(afterFirst, snap(), JUNE);
    }

    // ── Editing and deleting ─────────────────────────────────────────────────────────────────

    @Test
    void editingASetChangesItsMonth() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        long setId = logSet(march, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();

        editSet(setId, 102.5, 5);

        assertChangedExactly(before, snap(), MARCH);
    }

    @Test
    void deletingASetChangesItsMonth() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        long doomed = logSet(march, 100, 6);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();

        deleteSet(doomed);

        assertChangedExactly(before, snap(), MARCH);
    }

    // The case a row count alone would miss: the month holds exactly as many sets afterwards as
    // before, and it is still a different month. Every row version the insert adds is newer than the
    // one the delete removed, so the sum rises even though the count does not.
    @Test
    void deletingOneSetAndAddingAnotherKeepsTheCountButStillChangesTheMonth() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        long doomed = logSet(march, 100, 6);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();
        int setsBefore = setsInHistory(MARCH);

        deleteSet(doomed);
        logSet(march, 100, 7);

        assertEquals(setsBefore, setsInHistory(MARCH), "same number of sets in the month");
        assertChangedExactly(before, snap(), MARCH);
    }

    // The converse: a change that is fully undone leaves History exactly as it was, and so must
    // leave the fingerprint exactly as it was -- otherwise every no-op round trip costs a download.
    @Test
    void addingAndThenDeletingASetReturnsTheMonthToItsFingerprint() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        Snapshot before = snap();

        long added = logSet(march, 120, 3);
        assertNotEquals(before.fp().get(MARCH), snap().fp().get(MARCH));
        deleteSet(added);

        assertEquals(before, snap());
    }

    // ── Notes ────────────────────────────────────────────────────────────────────────────────

    @Test
    void savingEditingAndClearingANoteEachChangeTheMonth() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);

        Snapshot before = snap();
        saveNote(march, "felt heavy");
        Snapshot saved = snap();
        assertChangedExactly(before, saved, MARCH);

        saveNote(march, "felt heavy, left shoulder");
        Snapshot edited = snap();
        assertChangedExactly(saved, edited, MARCH);

        saveNote(march, "   ");   // a blank save deletes the row
        assertChangedExactly(edited, snap(), MARCH);
    }

    // ── Workouts ─────────────────────────────────────────────────────────────────────────────

    @Test
    void endingAWorkoutChangesItsMonth() throws Exception {
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        logLiveSet(exerciseId, 100, 5);
        Snapshot before = snap();

        mockMvc.perform(post("/api/people/" + personId + "/sessions/live/end")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());

        assertChangedExactly(before, snap(), JUNE);
    }

    // Auto-close is computed on every read of the live session, but only SAVED by a write:
    // GET /sessions/live runs read-only, so the stale workout still has no ended_at in the database
    // (and so in History) until the next set is logged. The fingerprint must follow History exactly:
    // unchanged by the read, changed by the write that persists the close.
    @Test
    void autoCloseMovesTheMonthWhenItIsSavedAndNotBefore() throws Exception {
        logLiveSet(exerciseId, 100, 5);
        Snapshot before = snap();

        clock.advance(Duration.ofHours(9));
        mockMvc.perform(get("/api/people/" + personId + "/sessions/live")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());
        assertEquals(before, snap(), "a read-only auto-close changes neither History nor its fingerprint");

        logLiveSet(exerciseId, 100, 5);   // closes the stale workout for real, and starts a new one
        Snapshot after = snap();
        assertChangedExactly(before, after, JUNE);
        assertTrue(after.content().get(JUNE).contains("\"endedAt\":\"2026-06-15T12:00:00Z\""),
                "the stale workout is now ended at its last activity");
    }

    @Test
    void addingAnEmptyPastWorkoutChangesItsMonth() throws Exception {
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();

        createPastSession("2026-05-20T10:00:00Z");

        assertChangedExactly(before, snap(), MAY);
    }

    // A workout moved to another month leaves one and joins the other: both must be re-sent, or the
    // device shows it in both months (or in neither).
    @Test
    void movingAWorkoutToAnotherMonthChangesBothMonths() throws Exception {
        long moving = createPastSession("2026-03-10T10:00:00Z");
        logSet(moving, 100, 5);
        long staying = createPastSession("2026-03-20T10:00:00Z");
        logSet(staying, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        long june = createPastSession("2026-06-01T10:00:00Z");
        logSet(june, 100, 5);
        Snapshot before = snap();

        mockMvc.perform(patch("/api/sessions/" + moving)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", "2026-05-12T10:00:00Z"))))
                .andExpect(status().isOk());

        assertChangedExactly(before, snap(), MARCH, MAY);
    }

    // Editing a workout's time within the same month changes only that month.
    @Test
    void changingAWorkoutsTimeWithinItsMonthChangesOnlyThatMonth() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();

        mockMvc.perform(patch("/api/sessions/" + march)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", "2026-03-10T18:30:00Z"))))
                .andExpect(status().isOk());

        assertChangedExactly(before, snap(), MARCH);
    }

    // ── Import ───────────────────────────────────────────────────────────────────────────────

    @Test
    void importingAndUndoingChangeEveryMonthTheyTouch() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        long june = createPastSession("2026-06-01T10:00:00Z");
        logSet(june, 100, 5);
        Snapshot before = snap();

        JsonNode imported = commitImport("""
                Exercise,Date,Reps
                Barbell Bench Press,2026-03-12,8
                Pull-up,2026-05-02,6
                """);
        Snapshot afterImport = snap();
        assertChangedExactly(before, afterImport, MARCH, MAY);

        mockMvc.perform(delete("/api/people/" + personId + "/imports/" + imported.get("batchId").asLong())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        assertChangedExactly(afterImport, snap(), MARCH, MAY);
        assertEquals(before, snap(), "an undone import leaves History as it was, so its fingerprint too");
    }

    // ── Exercise names ───────────────────────────────────────────────────────────────────────

    // History carries each entry's exercise NAME, so a rename rewrites every month that logged the
    // exercise -- a write to a table no set or session row points back from.
    @Test
    void renamingAnExerciseChangesEveryMonthThatLoggedItAndNoOther() throws Exception {
        long custom = createExercise("Zercher Squat");
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, custom, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, exerciseId, 100, 5);
        long june = createPastSession("2026-06-01T10:00:00Z");
        logSet(june, custom, 100, 5);
        Snapshot before = snap();

        mockMvc.perform(put("/api/exercises/" + custom)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Zercher Squat (paused)"))))
                .andExpect(status().isOk());

        assertChangedExactly(before, snap(), MARCH, JUNE);
    }

    // ── Isolation ────────────────────────────────────────────────────────────────────────────

    @Test
    void anotherPersonsWritesNeverChangeMine() throws Exception {
        long march = createPastSession("2026-03-10T10:00:00Z");
        logSet(march, 100, 5);
        long otherPerson = createPerson("Sam");
        Snapshot before = snap();

        long theirs = createPastSessionFor(otherPerson, "2026-03-11T10:00:00Z");
        logSet(theirs, 100, 5);
        saveNote(theirs, "their note");
        logLiveSetFor(otherPerson, exerciseId, 100, 5);

        assertEquals(before, snap());
    }

    // ── The Free-tier window ─────────────────────────────────────────────────────────────────

    // The floor is `now - 90 days` and moves every instant, so it is deliberately NOT hashed -- that
    // would change every Free month on every request. What changes is the set of rows it admits.
    @Test
    void aWorkoutAgingOutOfTheFreeWindowChangesItsMonth() throws Exception {
        setFullHistory(false);   // floor = 2026-03-17T12:00Z
        long leaving = createPastSession("2026-03-20T10:00:00Z");
        logSet(leaving, 100, 5);
        long staying = createPastSession("2026-03-30T10:00:00Z");
        logSet(staying, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();

        clock.advance(Duration.ofDays(5));   // floor = 2026-03-22T12:00Z -- 03-20 falls out

        assertChangedExactly(before, snap(), MARCH);
    }

    @Test
    void timePassingWithNothingAgingOutChangesNothingOnFree() throws Exception {
        setFullHistory(false);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);
        Snapshot before = snap();

        clock.advance(Duration.ofHours(6));

        assertEquals(before, snap());
    }

    // An upgrade is the one way rows ENTER the visible set with no write behind them. The flag is
    // what catches it: every month changes, and the months the window hid come back.
    @Test
    void upgradingAndDowngradingChangeEveryMonth() throws Exception {
        long january = createPastSession("2026-01-10T10:00:00Z");
        logSet(january, 100, 5);
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);

        setFullHistory(false);
        Snapshot free = snap();
        assertFalse(free.fp().containsKey("2026-01"), "January is outside the Free window");

        setFullHistory(true);
        Snapshot plus = snap();
        assertTrue(plus.fp().containsKey("2026-01"), "January is back on Plus");
        assertNotEquals(free.fp().get(MAY), plus.fp().get(MAY), "every month changes on upgrade");

        setFullHistory(false);
        assertEquals(free, snap(), "and back again on downgrade");
    }

    // ── The guard on the guard ───────────────────────────────────────────────────────────────

    // Every field History sends, and where the fingerprint picks it up. A new field fails this until
    // someone decides how the fingerprint covers it -- and adds a test above that changes it.
    @Test
    void everyFieldHistorySendsIsCoveredByTheFingerprint() {
        Map<Class<?>, Set<String>> covered = new LinkedHashMap<>();
        covered.put(HistorySessionDto.class, Set.of(
                "id", "startedAt", "endedAt", "manual",   // workout_sessions.row_version
                "entries"));                               // derived from the sets below
        covered.put(HistoryEntryDto.class, Set.of(
                "exerciseId", "sets",                      // workout_sets.row_version
                "exerciseName",                            // exercises.row_version
                "note"));                                  // session_exercise_notes.row_version
        covered.put(SetSummaryDto.class, Set.of(
                "weight", "reps", "durationSeconds", "unit"));   // workout_sets.row_version

        for (Map.Entry<Class<?>, Set<String>> entry : covered.entrySet()) {
            Set<String> actual = Arrays.stream(entry.getKey().getRecordComponents())
                    .map(RecordComponent::getName)
                    .collect(Collectors.toSet());
            assertEquals(entry.getValue(), actual, entry.getKey().getSimpleName()
                    + " changed shape: fold any new field into HistoryFingerprints, then list it here");
        }
    }

    // ── Writes that bypass the app entirely ──────────────────────────────────────────────────

    // The claim that makes row_version safe where a hand-kept version stamp was not: the DATABASE
    // stamps it, so no write path -- including one nobody has written yet, a migration, a hand fix in
    // production -- can forget. Proven by writing every column History reads with raw SQL, behind the
    // app's back, one at a time.
    @Test
    void rawSqlWritesToEveryColumnHistoryReadsChangeTheMonth() throws Exception {
        long custom = createExercise("Raw SQL Lift");
        long march = createPastSession("2026-03-10T10:00:00Z");
        long setId = logSet(march, custom, 100, 5);
        saveNote(march, "raw note");
        long may = createPastSession("2026-05-10T10:00:00Z");
        logSet(may, 100, 5);

        String[] writes = {
                "UPDATE workout_sets SET weight = weight + 1 WHERE id = " + setId,
                "UPDATE workout_sets SET reps = reps + 1 WHERE id = " + setId,
                "UPDATE workout_sets SET unit = CASE unit WHEN 'lb' THEN 'kg' ELSE 'lb' END WHERE id = " + setId,
                "UPDATE workout_sets SET created_at = DATEADD(second, 1, created_at) WHERE id = " + setId,
                "UPDATE workout_sessions SET ended_at = DATEADD(minute, 5, ended_at) WHERE id = " + march,
                "UPDATE workout_sessions SET manual = CASE manual WHEN 1 THEN 0 ELSE 1 END WHERE id = " + march,
                "UPDATE session_exercise_notes SET note = note + '!' WHERE session_id = " + march,
                "UPDATE exercises SET name = name + ' v2' WHERE id = " + custom,
        };
        for (String sql : writes) {
            Snapshot before = snap();
            jdbcTemplate.update(sql);
            assertChangedExactly(before, snap(), MARCH);
        }
    }

    // ── Month boundaries ─────────────────────────────────────────────────────────────────────

    // A month is the UTC month of started_at, decided by the database. The last 100ns of a month and
    // the first instant of the next must land in different months -- and the same months the loader
    // puts their content in, or a workout would be fingerprinted in one month and sent in another.
    @Test
    void workoutsEitherSideOfAMonthBoundaryLandInTheirOwnMonths() throws Exception {
        long last = createPastSession("2026-03-31T23:59:59.9999999Z");
        logSet(last, 100, 5);
        long first = createPastSession("2026-04-01T00:00:00Z");
        logSet(first, 100, 5);

        Snapshot snapshot = snap();   // also asserts the aggregate and the loaded rows agree
        assertEquals(Set.of(MARCH, "2026-04"), snapshot.fp().keySet());
        assertTrue(snapshot.content().get(MARCH).contains("\"id\":" + last));
        assertTrue(snapshot.content().get("2026-04").contains("\"id\":" + first));

        Snapshot before = snap();
        logSet(first, 105, 5);
        assertChangedExactly(before, snap(), "2026-04");
    }

    // ── The guard on the SQL ─────────────────────────────────────────────────────────────────

    // Every table History's loader reads must be in the fingerprint's aggregate, and must carry a
    // row_version. A join added to one and not the other -- or a new table with no row_version -- would
    // be a History input the fingerprint cannot see; this fails until both agree.
    @Test
    void everyTableHistoryReadsIsFingerprintedAndCarriesARowVersion() throws Exception {
        Set<String> loaded = tablesIn(sqlConstant(com.worktrac.backend.workoutsession.HistoryMonths.class, "LOAD"));
        Set<String> fingerprinted = tablesIn(sqlConstant(HistoryFingerprints.class, "AGGREGATE"));
        assertEquals(Set.of("workout_sessions", "workout_sets", "session_exercise_notes", "exercises"), loaded);
        assertEquals(loaded, fingerprinted, "the loader and the fingerprint must read the same tables");
        for (String table : loaded) {
            Integer columns = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND COLUMN_NAME = 'row_version' AND DATA_TYPE = 'timestamp'",
                    Integer.class, table);
            assertEquals(1, columns, table + " has no ROWVERSION row_version column");
        }
    }

    private static String sqlConstant(Class<?> owner, String field) throws Exception {
        java.lang.reflect.Field f = owner.getDeclaredField(field);
        f.setAccessible(true);
        return (String) f.get(null);
    }

    // Real tables named after FROM/JOIN (join hints included) -- not the statement's own CTEs, which
    // are recognised by their definition (`name AS (`) rather than by a naming convention, so adding
    // one can never make it look like a new table, nor hide a real one behind a familiar suffix.
    private static Set<String> tablesIn(String sql) {
        Set<String> ctes = new TreeSet<>();
        java.util.regex.Matcher c = java.util.regex.Pattern.compile("(?i)\\b([a-z_]+)\\s+AS\\s*\\(").matcher(sql);
        while (c.find()) ctes.add(c.group(1).toLowerCase());
        Set<String> tables = new TreeSet<>();
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(?i)\\b(?:FROM|JOIN)\\s+([a-z_]+)").matcher(sql);
        while (m.find()) {
            String name = m.group(1).toLowerCase();
            if (!ctes.contains(name)) tables.add(name);
        }
        return tables;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    // What the device would hold for each month -- its fingerprint -- next to what History actually
    // says for that month. Comparing both is what makes every test here a test of the one property
    // that matters: History never changes under an unchanged fingerprint.
    private record Snapshot(Map<String, String> fp, Map<String, String> content) {}

    private Snapshot snap() throws Exception {
        Map<String, String> fp = historyFingerprints.forPerson(personId, subscriptionService.historyFloor(accountId));
        JsonNode history = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        Map<String, StringBuilder> byMonth = new TreeMap<>();
        for (JsonNode session : history) {
            byMonth.computeIfAbsent(session.get("startedAt").asText().substring(0, 7), m -> new StringBuilder())
                    .append(session);
        }
        Map<String, String> content = new TreeMap<>();
        byMonth.forEach((month, json) -> content.put(month, json.toString()));

        // The fingerprint is computed twice -- aggregated in SQL to decide what to send, and summed
        // from the loaded rows to send beside the content. They must never disagree, or a month
        // would be re-sent forever (or, worse, never). Checked after every write in this class.
        JsonNode synced = objectMapper.readTree(mockMvc.perform(post("/api/people/" + personId + "/history/sync")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"have\":{}}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        Map<String, String> fromRows = new LinkedHashMap<>();
        synced.get("changed").properties().forEach(e -> fromRows.put(e.getKey(), e.getValue().get("fp").asText()));
        assertEquals(fp, fromRows, "the aggregate fingerprint and the loaded rows' fingerprint disagree");
        return new Snapshot(fp, content);
    }

    // `months` is exactly the set whose fingerprint changed; and, whatever the test, no month's
    // History content may change without its fingerprint changing too. That is the dangerous
    // direction -- the reverse (a fingerprint moving under unchanged content) only costs a redundant
    // download, and does happen: logging a set bumps its workout's last_activity_at.
    private static void assertChangedExactly(Snapshot before, Snapshot after, String... months) {
        Set<String> changedFp = changed(before.fp(), after.fp());
        assertEquals(new TreeSet<>(Set.of(months)), changedFp,
                "months whose fingerprint changed (before=" + before.fp().keySet() + ", after=" + after.fp().keySet() + ")");
        Set<String> changedContent = changed(before.content(), after.content());
        assertTrue(changedFp.containsAll(changedContent),
                "History changed in " + changedContent + " but the fingerprint only in " + changedFp);
    }

    private static Set<String> changed(Map<String, String> before, Map<String, String> after) {
        Set<String> all = new TreeSet<>(before.keySet());
        all.addAll(after.keySet());
        return all.stream()
                .filter(m -> !Objects.equals(before.get(m), after.get(m)))
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private int setsInHistory(String month) throws Exception {
        JsonNode history = objectMapper.readTree(mockMvc.perform(get("/api/people/" + personId + "/history")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        int count = 0;
        for (JsonNode session : history) {
            if (!session.get("startedAt").asText().startsWith(month)) continue;
            for (JsonNode entry : session.get("entries")) count += entry.get("sets").size();
        }
        return count;
    }

    private void setFullHistory(boolean full) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(full ? SubscriptionStatus.ACTIVE : SubscriptionStatus.FREE);
        subscription.setPlan(full ? BillingPlan.PLUS : BillingPlan.FREE);
        subscriptionRepository.save(subscription);
    }

    private long createPastSession(String startedAt) throws Exception {
        return createPastSessionFor(personId, startedAt);
    }

    private long createPastSessionFor(long person, String startedAt) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + person + "/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("startedAt", startedAt))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private long logSet(long sessionId, double weight, int reps) throws Exception {
        return logSet(sessionId, exerciseId, weight, reps);
    }

    private long logSet(long sessionId, long exercise, double weight, int reps) throws Exception {
        String response = mockMvc.perform(post("/api/sessions/" + sessionId + "/sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("exerciseId", exercise, "weight", weight, "reps", reps))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("set").get("id").asLong();
    }

    private void logLiveSet(long exercise, double weight, int reps) throws Exception {
        logLiveSetFor(personId, exercise, weight, reps);
    }

    private void logLiveSetFor(long person, long exercise, double weight, int reps) throws Exception {
        mockMvc.perform(post("/api/people/" + person + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("exerciseId", exercise, "weight", weight, "reps", reps))))
                .andExpect(status().isOk());
    }

    private void editSet(long setId, double weight, int reps) throws Exception {
        mockMvc.perform(patch("/api/sets/" + setId)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("weight", weight, "reps", reps))))
                .andExpect(status().isOk());
    }

    private void deleteSet(long setId) throws Exception {
        mockMvc.perform(delete("/api/sets/" + setId).header("Authorization", "Bearer " + token))
                .andExpect(status().is2xxSuccessful());
    }

    private void saveNote(long sessionId, String note) throws Exception {
        mockMvc.perform(put("/api/sessions/" + sessionId + "/exercises/" + exerciseId + "/note")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("note", note))))
                .andExpect(status().is2xxSuccessful());
    }

    private JsonNode commitImport(String csv) throws Exception {
        String response = mockMvc.perform(post("/api/people/" + personId + "/import")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("csv", csv, "filename", "workouts.csv"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
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
}
