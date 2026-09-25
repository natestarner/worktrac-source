package com.worktrac.backend.workoutsession;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// The History sync's statements must cost in proportion to THIS PERSON's rows, never to the table.
// Every other History test runs against a near-empty database, where a pass over the whole of
// workout_sets costs nothing -- which is how #343 shipped a full sync that took ~0.3 s locally and
// ~10 minutes at 100% DTU on lower, whose tables hold every e2e household ever created.
//
// So this does not time anything. It runs the real statements, reads back the plans SQL Server
// actually compiled for them, and requires every read of a History table to be a SEEK (reached
// through the person, their sessions or their exercises) and never a LOOKUP (a covering index that
// stopped covering). Both are properties of the plan's shape, so they hold at any data size, and a
// scan that would be harmless here fails exactly as it would have hurt on lower.
//
// ⚠️ If this fails after you add a column to HistoryFingerprints or HistoryMonths, add that column to
// the matching index's INCLUDE list in a new migration (see V83). If it fails after a plan changed
// shape, see the join hints' comment in HistoryFingerprints -- do not relax the assertion.
@AutoConfigureMockMvc
class HistorySyncCostTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, HistorySyncCostTest.class);
    }

    private static final Set<String> HISTORY_TABLES =
            Set.of("workout_sessions", "workout_sets", "session_exercise_notes", "exercises");

    @Autowired private MockMvc mockMvc;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private HistoryMonths historyMonths;
    @Autowired private HistoryFingerprints historyFingerprints;
    @Autowired private JdbcTemplate jdbcTemplate;

    @MockitoBean private EmailService emailService;

    private long personId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "sync-cost-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration = RegistrationTestSupport.registerAndConfirm(
                mockMvc, new ObjectMapper(), testCodeCache, email, "Nate");
        personId = registration.get("person").get("id").asLong();
        List<Long> exerciseIds = jdbcTemplate.queryForList(
                "SELECT TOP (3) id FROM exercises WHERE account_id IS NULL ORDER BY id", Long.class);

        // Lower's proportions, because plan shape depends on them. This person has years of History
        // (~4 years, daily) and is still a sliver of every table beside everybody else's. With the
        // person alone in the database, a pass over a whole table and a seek on their range cost the
        // same and the optimizer may pick either; with a small History it seeks whatever the
        // statement says. Only here does a statement without its join hints choose a pass over the
        // notes index -- verified by removing them.
        JsonNode other = RegistrationTestSupport.registerAndConfirm(mockMvc, new ObjectMapper(), testCodeCache,
                "sync-cost-other-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com", "Other");
        long otherPersonId = other.get("person").get("id").asLong();
        seedDailyHistory(otherPersonId, 30000, exerciseIds, 1);
        jdbcTemplate.update("""
                WITH n AS (SELECT TOP (2000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
                           FROM sys.all_objects a CROSS JOIN sys.all_objects b)
                INSERT INTO exercises (account_id, name, tracking_type, is_deleted, created_at)
                SELECT ?, CONCAT('Other exercise ', i), 'strength', 0, '2026-01-01' FROM n""",
                other.get("account").get("id").asLong());

        seedDailyHistory(personId, 1500, exerciseIds, 4);
        jdbcTemplate.execute("UPDATE STATISTICS workout_sessions");
        jdbcTemplate.execute("UPDATE STATISTICS workout_sets");
        jdbcTemplate.execute("UPDATE STATISTICS session_exercise_notes");
        jdbcTemplate.execute("UPDATE STATISTICS exercises");
    }

    // One workout a day back from June 2026, a set of each exercise in every one, and a note on every
    // `noteEvery`th. Set-based, so tens of thousands of rows take a second rather than a minute.
    private void seedDailyHistory(long person, int workouts, List<Long> exerciseIds, int noteEvery) {
        jdbcTemplate.update("""
                WITH n AS (SELECT TOP (?) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
                           FROM sys.all_objects a CROSS JOIN sys.all_objects b)
                INSERT INTO workout_sessions (person_id, started_at, ended_at, last_activity_at, manual)
                SELECT ?, DATEADD(day, -CAST(i AS INT), '2026-06-01 10:00'),
                       DATEADD(day, -CAST(i AS INT), '2026-06-01 11:00'),
                       DATEADD(day, -CAST(i AS INT), '2026-06-01 11:00'), 1
                FROM n""", workouts, person);
        for (long exerciseId : exerciseIds) {
            jdbcTemplate.update("""
                    INSERT INTO workout_sets (session_id, person_id, exercise_id, weight, reps, unit)
                    SELECT id, person_id, ?, 100, 5, 'lb' FROM workout_sessions WHERE person_id = ?""",
                    exerciseId, person);
        }
        jdbcTemplate.update("""
                INSERT INTO session_exercise_notes (session_id, exercise_id, note)
                SELECT id, ?, 'felt heavy' FROM workout_sessions WHERE person_id = ? AND id % ? = 0""",
                exerciseIds.get(0), person, noteEvery);
    }

    @Test
    void everyHistorySyncStatementSeeksThroughThePersonsOwnRows() throws Exception {
        // Only this database's plans, and only the ones compiled from here on.
        jdbcTemplate.execute("ALTER DATABASE SCOPED CONFIGURATION CLEAR PROCEDURE_CACHE");

        Instant floor = Instant.parse("2026-03-01T00:00:00Z");
        Instant from = Instant.parse("2026-04-01T00:00:00Z");
        Instant to = Instant.parse("2026-05-01T00:00:00Z");
        // Every shape each statement is issued in: full History and the Free window for the
        // aggregate; the whole History (GET /history, a full sync) and changed-month ranges for the load.
        assertTrue(historyFingerprints.forPerson(personId, null).size() > 1);
        assertTrue(historyFingerprints.forPerson(personId, floor).size() > 1);
        assertTrue(historyMonths.load(personId, null, null, null).size() > 1);
        assertTrue(historyMonths.load(personId, floor, from, to).size() == 1);
        assertTrue(historyMonths.load(personId, null, from, null).size() > 1);

        List<String> plans = jdbcTemplate.queryForList("""
                SELECT p.query_plan
                FROM sys.dm_exec_query_stats qs
                CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
                CROSS APPLY sys.dm_exec_text_query_plan(qs.plan_handle, qs.statement_start_offset,
                                                        qs.statement_end_offset) p
                CROSS APPLY (SELECT CAST(value AS INT) AS dbid FROM sys.dm_exec_plan_attributes(qs.plan_handle)
                             WHERE attribute = 'dbid') a
                WHERE a.dbid = DB_ID()
                  AND (st.text LIKE '%note_agg%' OR st.text LIKE '%person_exercises%')
                  AND st.text NOT LIKE '%dm_exec_query_stats%'""", String.class);
        assertEquals(5, plans.size(), "one compiled plan per statement shape issued above");

        List<String> violations = new ArrayList<>();
        Set<String> tablesRead = new TreeSet<>();
        for (String plan : plans) {
            for (Access access : accesses(plan)) {
                if (!HISTORY_TABLES.contains(access.table())) {
                    continue;
                }
                tablesRead.add(access.table());
                if (!access.physicalOp().endsWith("Seek") || access.lookup()) {
                    violations.add((plan.contains("note_agg") ? "aggregate: " : "load: ") + access);
                }
            }
        }

        // Non-vacuous: every History table was actually read, and so actually checked.
        assertEquals(new TreeSet<>(HISTORY_TABLES), tablesRead);
        assertTrue(violations.isEmpty(),
                "History sync reads a table other than by seeking through the person's rows "
                        + "(cost would follow the table, not the person): " + violations);
    }

    record Access(String table, String index, String physicalOp, boolean lookup) {}

    // Each operator that reads a table directly: the <RelOp> whose child is an <IndexScan> or
    // <TableScan>. A key lookup is a Clustered Index Seek whose IndexScan carries Lookup="true".
    private static List<Access> accesses(String planXml) throws Exception {
        var factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(false);
        var document = factory.newDocumentBuilder()
                .parse(new ByteArrayInputStream(planXml.getBytes(StandardCharsets.UTF_8)));
        List<Access> accesses = new ArrayList<>();
        NodeList relOps = document.getElementsByTagName("RelOp");
        for (int i = 0; i < relOps.getLength(); i++) {
            Element relOp = (Element) relOps.item(i);
            for (Node child = relOp.getFirstChild(); child != null; child = child.getNextSibling()) {
                if (!(child instanceof Element reader)
                        || !(reader.getTagName().equals("IndexScan") || reader.getTagName().equals("TableScan"))) {
                    continue;
                }
                Element object = (Element) reader.getElementsByTagName("Object").item(0);
                String lookup = reader.getAttribute("Lookup");
                accesses.add(new Access(
                        strip(object.getAttribute("Table")), strip(object.getAttribute("Index")),
                        relOp.getAttribute("PhysicalOp"), "true".equals(lookup) || "1".equals(lookup)));
            }
        }
        return accesses;
    }

    private static String strip(String bracketed) {
        return bracketed.replace("[", "").replace("]", "");
    }
}
