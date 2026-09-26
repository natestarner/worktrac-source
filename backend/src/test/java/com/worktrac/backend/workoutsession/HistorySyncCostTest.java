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
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
// actually compiled for them (from Query Store), and requires three things -- each one a way lower
// actually broke:
//   - every read of a History table is a SEEK (reached through the person, their sessions or their
//     exercises) and never a LOOKUP (a covering index that stopped covering). Both are properties of
//     the plan's shape, so they hold at any data size, and a scan that would be harmless here fails
//     exactly as it would have hurt on lower. (#343: 10 minutes at 100% DTU.)
//   - the big person's plans were compiled FOR the big person, after a five-set household ran the same
//     statements first -- exactly the order lower sees after every e2e run. (#345 passed the first
//     check and still ran ~50s per sync on lower, on a plan cached for five rows.)
//   - a SMALL History's plans are cached: its repeat run compiles nothing. (#348's OPTION (RECOMPILE)
//     for everyone passed the second check and held lower's CPU at 100% for 35 minutes compiling.)
//     A large History is compiled per execution on purpose -- see HistoryPlanSize.
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
    private long tinyPersonId;

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

        // And a brand-new household with one workout -- the shape of every e2e household on lower.
        JsonNode tiny = RegistrationTestSupport.registerAndConfirm(mockMvc, new ObjectMapper(), testCodeCache,
                "sync-cost-tiny-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com", "Tiny");
        tinyPersonId = tiny.get("person").get("id").asLong();
        seedDailyHistory(tinyPersonId, 1, exerciseIds, 1);

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
    void everyHistorySyncStatementRunsAPlanBuiltForItsPersonCachedAndSeekingThroughTheirRows() throws Exception {
        // Query Store rather than the plan cache: it records every plan with when it was compiled and
        // when it last ran, whatever the caching. ALL, because the default capture mode skips
        // statements it has only seen once.
        jdbcTemplate.execute("ALTER DATABASE CURRENT SET QUERY_STORE = ON "
                + "(OPERATION_MODE = READ_WRITE, QUERY_CAPTURE_MODE = ALL)");

        // What lower's e2e run does before anyone with real History syncs: a five-set household runs
        // every statement first. A plan cached from here is built for five rows.
        runEveryShape(tinyPersonId);
        LocalDateTime afterTiny = pause();

        // 1. The big person must run plans COMPILED during their own run -- never the tiny one's.
        runEveryShape(personId);
        LocalDateTime afterBig = pause();
        List<Map<String, Object>> firstRun = plansRunSince(afterTiny);
        Set<Object> statements = new TreeSet<>();
        List<String> planXmls = new ArrayList<>();
        List<Object> reused = new ArrayList<>();
        for (Map<String, Object> plan : firstRun) {
            statements.add(plan.get("query_id"));
            planXmls.add((String) plan.get("query_plan"));
            if (compiledAt(plan).isBefore(afterTiny)) reused.add(plan.get("query_id"));
        }
        assertEquals(5, statements.size(), "one statement per shape issued in runEveryShape");
        assertTrue(reused.isEmpty(), "the big person ran a plan compiled for the tiny one -- see HistoryPlanSize: "
                + reused);

        // 2. A SMALL History's plans must be cached: its repeat run compiles nothing. Every e2e household
        // is small, so this is what keeps an e2e run from compiling hundreds of times -- OPTION
        // (RECOMPILE) for everyone passes the first check and fails this one, which is what it did to
        // lower's CPU. (The big person recompiling on every run is deliberate; see HistoryPlanSize.)
        runEveryShape(tinyPersonId);
        pause();
        List<Map<String, Object>> tinyRepeat = plansRunSince(afterBig);
        assertEquals(5, tinyRepeat.stream().map(plan -> plan.get("query_id")).distinct().count(),
                "the tiny household's repeat run issued every shape");
        List<Object> recompiled = new ArrayList<>();
        for (Map<String, Object> plan : tinyRepeat) {
            if (!compiledAt(plan).isBefore(afterBig)) recompiled.add(plan.get("query_id"));
        }
        assertTrue(recompiled.isEmpty(), "a small History's statement compiled again on a repeat run -- small "
                + "Histories must reuse one cached plan per size class (see HistoryPlanSize): " + recompiled);

        List<String> violations = new ArrayList<>();
        Set<String> tablesRead = new TreeSet<>();
        for (String plan : planXmls) {
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

    // Query Store keeps times to ~10ms, rounded either way, so a boundary taken in the same tick as a
    // compile could order them wrongly -- a vacuous green or a false red. A clear gap on both sides of
    // the timestamp makes "before" and "after" unambiguous.
    private LocalDateTime pause() throws InterruptedException {
        Thread.sleep(200);
        LocalDateTime now = jdbcTemplate.queryForObject("SELECT SYSUTCDATETIME()", LocalDateTime.class);
        Thread.sleep(200);
        return now;
    }

    // Every plan of the two History statements that executed after `since`, with when it was compiled.
    private List<Map<String, Object>> plansRunSince(LocalDateTime since) {
        return jdbcTemplate.queryForList("""
                SELECT q.query_id,
                       CAST(SWITCHOFFSET(p.last_compile_start_time, '+00:00') AS DATETIME2) AS compiled_utc,
                       CAST(p.query_plan AS NVARCHAR(MAX)) AS query_plan
                FROM sys.query_store_plan p
                JOIN sys.query_store_query q ON q.query_id = p.query_id
                JOIN sys.query_store_query_text t ON t.query_text_id = q.query_text_id
                WHERE (t.query_sql_text LIKE '%note_agg%' OR t.query_sql_text LIKE '%person_exercises%')
                  AND t.query_sql_text NOT LIKE '%query_store%'
                  AND EXISTS (SELECT 1 FROM sys.query_store_runtime_stats rs
                              WHERE rs.plan_id = p.plan_id
                                AND CAST(SWITCHOFFSET(rs.last_execution_time, '+00:00') AS DATETIME2) >= ?)""",
                since);
    }

    private static LocalDateTime compiledAt(Map<String, Object> plan) {
        return ((java.sql.Timestamp) plan.get("compiled_utc")).toLocalDateTime();
    }

    // Every shape each statement is issued in: full History and the Free window for the aggregate;
    // the whole History (GET /history, a full sync) and changed-month ranges for the load.
    private void runEveryShape(long person) {
        Instant floor = Instant.parse("2026-03-01T00:00:00Z");
        Instant from = Instant.parse("2026-04-01T00:00:00Z");
        Instant to = Instant.parse("2026-05-01T00:00:00Z");
        historyFingerprints.forPerson(person, null);
        historyFingerprints.forPerson(person, floor);
        historyMonths.load(person, null, null, null);
        historyMonths.load(person, floor, from, to);
        historyMonths.load(person, null, from, null);
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
