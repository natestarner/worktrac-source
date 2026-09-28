package com.worktrac.backend.stats;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionStatus;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.QueryPlans;
import com.worktrac.backend.support.QueryPlans.Access;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// A MEASUREMENT, not a guard: what each PRs/Trends request costs the database, per request, beside
// the History sync's requests as the reference point. It is the baseline for moving those screens
// onto History (docs/architecture/history-sync.md, "Not covered here"), taken the way the History
// work taught: lower's PROPORTIONS (a five-year person beside a much larger household), a tiny
// household running every request first (what lower's e2e run does before anyone with real History
// shows up), and the plan shapes and page reads SQL Server actually recorded -- never a local
// timing on its own (docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md).
//
// Opt-in, because seeding lower-sized tables takes a while and it asserts nothing about the app:
//   mvn test -Dtest=StatsCostProbe -Dstats.probe=true
// Writes target/stats-cost-probe.md.
@AutoConfigureMockMvc
@EnabledIfSystemProperty(named = "stats.probe", matches = "true")
class StatsCostProbe extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, StatsCostProbe.class);
    }

    // The barrage account's shape on lower: five years of daily workouts (~1,827), ~12 sets each
    // (21,916 sets there), a rotating handful of exercises per workout from a pool, a note on some.
    private static final int BIG_WORKOUTS = Integer.getInteger("stats.probe.workouts", 1827);
    private static final int EXERCISE_POOL = 24;
    private static final int EXERCISES_PER_WORKOUT = 4;
    private static final int SETS_PER_EXERCISE = 3;
    // Everybody else, so a pass over a table costs what it would on lower (well over a million sets
    // there; History's cost work measured against 300k workouts / 1.2M sets / 40k exercises).
    private static final int OTHER_WORKOUTS = Integer.getInteger("stats.probe.otherWorkouts", 300_000);
    private static final int OTHER_EXERCISES = 40_000;
    // Every household logs against the PRELOADED exercises, as lower's e2e households and most real
    // ones do, instead of each against its own. It changes plans, not just numbers: an exercise id
    // shared by everybody makes (person, exercise) look unselective, and a plan compiled for a
    // one-workout household then walks the big person's every workout (StatsCostTest).
    private static final boolean SHARED_EXERCISES = Boolean.getBoolean("stats.probe.sharedExercises");

    @Autowired private MockMvc mockMvc;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private SubscriptionRepository subscriptionRepository;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    record Household(String token, long personId, long accountId, long exerciseId) {}

    record Statement(long queryId, String text, long executions, double reads, double cpuMs, double durationMs,
                     List<Access> accesses) {}

    record Measured(String request, String who, String run, int bytes, List<Statement> statements) {
        long executions() { return statements.stream().mapToLong(Statement::executions).sum(); }
        double reads() { return statements.stream().mapToDouble(Statement::reads).sum(); }
        double cpuMs() { return statements.stream().mapToDouble(Statement::cpuMs).sum(); }
        double durationMs() { return statements.stream().mapToDouble(Statement::durationMs).sum(); }
        String shape() {
            TreeSet<String> bad = new TreeSet<>();
            for (Statement s : statements) {
                for (Access a : s.accesses()) {
                    if (!a.physicalOp().endsWith("Seek")) bad.add(a.physicalOp() + " " + a.table());
                    else if (a.lookup()) bad.add("Key Lookup " + a.table());
                }
            }
            return bad.isEmpty() ? "seeks only" : String.join(", ", bad);
        }
    }

    @Test
    void measure() throws Exception {
        long seedStart = System.nanoTime();
        List<Long> preloaded = jdbcTemplate.queryForList(
                "SELECT id FROM exercises WHERE account_id IS NULL ORDER BY id", Long.class);
        Household other = register("other");
        if (!SHARED_EXERCISES) seedExercises(other.accountId(), OTHER_EXERCISES);
        seedOther(other.personId(), catalog(other.accountId()), SHARED_EXERCISES ? Math.min(500, preloaded.size()) : 500);

        Household big = register("big");
        List<Long> bigExercises = SHARED_EXERCISES ? preloaded : seedExercises(big.accountId(), EXERCISE_POOL);
        seedBig(big.personId(), catalog(big.accountId()));
        big = new Household(big.token(), big.personId(), big.accountId(), bigExercises.get(0));

        Household tiny = register("tiny");
        List<Long> tinyExercises = SHARED_EXERCISES ? preloaded.subList(0, 3) : seedExercises(tiny.accountId(), 3);
        seedTiny(tiny.personId(), tinyExercises);
        tiny = new Household(tiny.token(), tiny.personId(), tiny.accountId(), tinyExercises.get(0));

        for (Household h : List.of(big, tiny, other)) setPlus(h.accountId());
        for (String table : List.of("workout_sessions", "workout_sets", "session_exercise_notes", "exercises")) {
            jdbcTemplate.execute("UPDATE STATISTICS " + table);
        }
        double seedSeconds = (System.nanoTime() - seedStart) / 1e9;

        jdbcTemplate.execute("ALTER DATABASE CURRENT SET QUERY_STORE = ON "
                + "(OPERATION_MODE = READ_WRITE, QUERY_CAPTURE_MODE = ALL)");

        Map<String, Function<Household, RequestBuilder>> requests = requests();
        List<Measured> results = new ArrayList<>();
        // The tiny household first, every request, so any plan it leaves cached is what the big
        // person meets -- lower's order after every e2e run. Then each person twice: the first run
        // may compile, the repeat shows the cached plan.
        for (Household who : List.of(tiny, big)) {
            String label = who == tiny ? "tiny" : "5-year";
            for (var request : requests.entrySet()) {
                results.add(measure(request.getKey(), label, "first", request.getValue().apply(who)));
                results.add(measure(request.getKey(), label, "repeat", request.getValue().apply(who)));
            }
        }

        assertFalse(results.stream().allMatch(m -> m.statements().isEmpty()),
                "Query Store recorded nothing -- the probe measured nothing");
        String report = report(results, seedSeconds);
        Path out = Path.of("target", "stats-cost-probe.md");
        Files.createDirectories(out.getParent());
        Files.writeString(out, report, StandardCharsets.UTF_8);
        System.out.println(report);
    }

    // Every read the PRs and Trends screens make, plus the Log screen's per-exercise summary (the
    // other StatsService load) and the History sync's three everyday shapes as the yardstick.
    private Map<String, Function<Household, RequestBuilder>> requests() {
        Map<String, Function<Household, RequestBuilder>> r = new LinkedHashMap<>();
        String zone = "zone=America%2FNew_York";
        r.put("GET /prs", h -> auth(get("/api/people/" + h.personId() + "/prs"), h));
        r.put("GET /trends/overview?weeks=12", h -> auth(get("/api/people/" + h.personId()
                + "/trends/overview?weeks=12&" + zone), h));
        r.put("GET /trends/overview?weeks=260", h -> auth(get("/api/people/" + h.personId()
                + "/trends/overview?weeks=260&" + zone), h));
        r.put("GET /trends/exercises/{id}?weeks=12", h -> auth(get("/api/people/" + h.personId()
                + "/trends/exercises/" + h.exerciseId() + "?weeks=12&" + zone), h));
        r.put("GET /exercises/{id}/records", h -> auth(get("/api/people/" + h.personId()
                + "/exercises/" + h.exerciseId() + "/records?" + zone), h));
        r.put("GET /exercises/{id}/summary", h -> auth(get("/api/people/" + h.personId()
                + "/exercises/" + h.exerciseId() + "/summary"), h));
        r.put("POST /history/sync (full, holds nothing)", h -> auth(post("/api/people/" + h.personId()
                + "/history/sync").contentType(MediaType.APPLICATION_JSON).content("{\"have\":{}}"), h));
        r.put("POST /history/sync (ordinary, nothing changed)", h -> auth(post("/api/people/" + h.personId()
                + "/history/sync").contentType(MediaType.APPLICATION_JSON).content(heldMonths(h)), h));
        r.put("POST /history/sync (scoped, after a set)", h -> auth(post("/api/people/" + h.personId()
                + "/history/sync").contentType(MediaType.APPLICATION_JSON).content(scopedToLatest(h)), h));
        return r;
    }

    private Measured measure(String name, String who, String run, RequestBuilder request) throws Exception {
        jdbcTemplate.execute("ALTER DATABASE CURRENT SET QUERY_STORE CLEAR");
        byte[] body = mockMvc.perform(request).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        List<Statement> statements = new ArrayList<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList("""
                SELECT q.query_id,
                       t.query_sql_text AS text,
                       SUM(rs.count_executions) AS executions,
                       SUM(rs.avg_logical_io_reads * rs.count_executions) AS reads,
                       SUM(rs.avg_cpu_time * rs.count_executions) / 1000.0 AS cpu_ms,
                       SUM(rs.avg_duration * rs.count_executions) / 1000.0 AS duration_ms,
                       MAX(CAST(p.query_plan AS NVARCHAR(MAX))) AS query_plan
                FROM sys.query_store_runtime_stats rs
                JOIN sys.query_store_plan p ON p.plan_id = rs.plan_id
                JOIN sys.query_store_query q ON q.query_id = p.query_id
                JOIN sys.query_store_query_text t ON t.query_text_id = q.query_text_id
                WHERE t.query_sql_text NOT LIKE '%query_store%'
                  AND t.query_sql_text NOT LIKE '%QUERY_STORE%'
                GROUP BY q.query_id, t.query_sql_text""")) {
            String plan = (String) row.get("query_plan");
            statements.add(new Statement(((Number) row.get("query_id")).longValue(), (String) row.get("text"),
                    ((Number) row.get("executions")).longValue(), ((Number) row.get("reads")).doubleValue(),
                    ((Number) row.get("cpu_ms")).doubleValue(), ((Number) row.get("duration_ms")).doubleValue(),
                    plan == null ? List.of() : QueryPlans.accesses(plan)));
        }
        statements.sort((a, b) -> Double.compare(b.reads(), a.reads()));
        return new Measured(name, who, run, body.length, statements);
    }

    private String report(List<Measured> results, double seedSeconds) {
        long otherSets = jdbcTemplate.queryForObject("SELECT COUNT_BIG(*) FROM workout_sets", Long.class);
        long sessions = jdbcTemplate.queryForObject("SELECT COUNT_BIG(*) FROM workout_sessions", Long.class);
        long exercises = jdbcTemplate.queryForObject("SELECT COUNT_BIG(*) FROM exercises", Long.class);
        StringBuilder md = new StringBuilder();
        md.append("# Stats cost probe\n\n");
        md.append(String.format("Tables: %,d workouts, %,d sets, %,d exercises. The 5-year person: %,d workouts, "
                        + "%d-exercise pool, %d exercises x %d sets per workout. Exercises: %s. Seeded in %.0fs.%n%n",
                sessions, otherSets, exercises, BIG_WORKOUTS, EXERCISE_POOL, EXERCISES_PER_WORKOUT,
                SETS_PER_EXERCISE, SHARED_EXERCISES ? "every household shares the preloaded catalog"
                        : "each household its own", seedSeconds));
        md.append("Per request, from Query Store. Reads are 8 KB logical page reads. Timings are local and "
                + "only comparable to each other, never to lower. Bytes are the uncompressed JSON body.\n\n");
        md.append("| Request | Who | Run | Statements (execs) | Page reads | CPU ms | DB ms | Bytes | Plan shape |\n");
        md.append("|---|---|---|---:|---:|---:|---:|---:|---|\n");
        for (Measured m : results) {
            md.append(String.format("| %s | %s | %s | %d (%d) | %,.0f | %.1f | %.1f | %,d | %s |%n",
                    m.request(), m.who(), m.run(), m.statements().size(), m.executions(), m.reads(), m.cpuMs(),
                    m.durationMs(), m.bytes(), m.shape()));
        }
        md.append("\n## Statements behind each 5-year repeat run\n");
        for (Measured m : results) {
            if (!m.who().equals("5-year") || !m.run().equals("repeat")) continue;
            md.append("\n### ").append(m.request()).append("\n\n");
            md.append("| Execs | Page reads | CPU ms | Accesses | Statement |\n|---:|---:|---:|---|---|\n");
            for (Statement s : m.statements()) {
                TreeSet<String> accesses = new TreeSet<>();
                for (Access a : s.accesses()) {
                    accesses.add((a.lookup() ? "Key Lookup" : a.physicalOp()) + " " + a.table() + "." + a.index());
                }
                String text = s.text().replaceAll("\\s+", " ").replace("|", "\\|");
                md.append(String.format("| %d | %,.0f | %.1f | %s | `%s` |%n", s.executions(), s.reads(), s.cpuMs(),
                        String.join("; ", accesses), text.length() > 160 ? text.substring(0, 160) + "..." : text));
            }
        }
        return md.toString();
    }

    // --- households and seeding ---------------------------------------------------------------

    private Household register(String name) throws Exception {
        JsonNode r = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                "stats-probe-" + name + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com", name);
        return new Household(r.get("token").asText(), r.get("person").get("id").asLong(),
                r.get("account").get("id").asLong(), 0);
    }

    private void setPlus(long accountId) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(SubscriptionStatus.ACTIVE);
        subscription.setPlan(BillingPlan.PLUS);
        subscriptionRepository.save(subscription);
    }

    // Whose exercises a household's sets name: its own, or (0) the preloaded catalog everybody shares.
    private static long catalog(long accountId) {
        return SHARED_EXERCISES ? 0 : accountId;
    }

    private List<Long> seedExercises(long accountId, int count) {
        jdbcTemplate.update("""
                WITH n AS (SELECT TOP (?) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
                           FROM sys.all_objects a CROSS JOIN sys.all_objects b)
                INSERT INTO exercises (account_id, name, tracking_type, is_deleted, created_at)
                SELECT ?, CONCAT('Probe exercise ', i), 'strength', 0, '2020-01-01' FROM n""", count, accountId);
        return jdbcTemplate.queryForList(
                "SELECT id FROM exercises WHERE account_id = ? ORDER BY id", Long.class, accountId);
    }

    // One workout a day for five years back from today (so every Trends range has data), four
    // exercises a workout rotating through the pool, three sets each with varying load and reps so
    // records move, and the last exercise of the pool done at bodyweight (weight 0).
    private void seedBig(long personId, long accountId) {
        jdbcTemplate.update("""
                WITH n AS (SELECT TOP (?) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
                           FROM sys.all_objects a CROSS JOIN sys.all_objects b)
                INSERT INTO workout_sessions (person_id, started_at, ended_at, last_activity_at, manual)
                SELECT ?, DATEADD(hour, 17, DATEADD(day, -CAST(i AS INT), CAST(CAST(SYSUTCDATETIME() AS DATE) AS DATETIME2))),
                          DATEADD(hour, 18, DATEADD(day, -CAST(i AS INT), CAST(CAST(SYSUTCDATETIME() AS DATE) AS DATETIME2))),
                          DATEADD(hour, 18, DATEADD(day, -CAST(i AS INT), CAST(CAST(SYSUTCDATETIME() AS DATE) AS DATETIME2))), 0
                FROM n""", BIG_WORKOUTS, personId);
        for (int slot = 0; slot < EXERCISES_PER_WORKOUT; slot++) {
            for (int set = 0; set < SETS_PER_EXERCISE; set++) {
                jdbcTemplate.update("""
                        INSERT INTO workout_sets (session_id, person_id, exercise_id, weight, reps, unit, created_at)
                        SELECT ws.id, ws.person_id, ex.id,
                               CASE WHEN ex.j = ? - 1 THEN 0 ELSE CAST(45 + (ws.i % 60) * 2.5 + ? * 5 AS DECIMAL(6,2)) END,
                               3 + ((ws.i + ?) % 8), 'lb',
                               DATEADD(second, (? * ? + ?) * 150, ws.started_at)
                        FROM (SELECT id, person_id, started_at, ROW_NUMBER() OVER (ORDER BY started_at, id) AS i
                              FROM workout_sessions WHERE person_id = ?) ws
                        JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS j
                              FROM exercises WHERE ISNULL(account_id, 0) = ?) ex
                          ON ex.j = (ws.i * ? + ?) % ?""",
                        EXERCISE_POOL, set, set, slot, SETS_PER_EXERCISE, set, personId, accountId,
                        EXERCISES_PER_WORKOUT, slot, EXERCISE_POOL);
            }
        }
        jdbcTemplate.update("""
                INSERT INTO session_exercise_notes (session_id, exercise_id, note)
                SELECT s.id, MIN(w.exercise_id), 'felt heavy'
                FROM workout_sessions s JOIN workout_sets w ON w.session_id = s.id
                WHERE s.person_id = ? AND s.id % 4 = 0
                GROUP BY s.id""", personId);
    }

    // Everybody else's rows: one enormous household spread over years, four sets a workout.
    private void seedOther(long personId, long accountId, int pool) {
        jdbcTemplate.update("""
                WITH n AS (SELECT TOP (?) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
                           FROM sys.all_objects a CROSS JOIN sys.all_objects b)
                INSERT INTO workout_sessions (person_id, started_at, ended_at, last_activity_at, manual)
                SELECT ?, DATEADD(minute, -CAST(i AS INT) * 11, '2026-06-01 10:00'),
                          DATEADD(minute, -CAST(i AS INT) * 11 + 5, '2026-06-01 10:00'),
                          DATEADD(minute, -CAST(i AS INT) * 11 + 5, '2026-06-01 10:00'), 1
                FROM n""", OTHER_WORKOUTS, personId);
        for (int k = 0; k < 4; k++) {
            jdbcTemplate.update("""
                    INSERT INTO workout_sets (session_id, person_id, exercise_id, weight, reps, unit)
                    SELECT s.id, s.person_id, ex.id, 100, 5, 'lb'
                    FROM workout_sessions s
                    JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS j
                          FROM exercises WHERE ISNULL(account_id, 0) = ?) ex
                      ON ex.j = (s.id * 4 + ?) % ?
                    WHERE s.person_id = ?""", accountId, k, pool, personId);
        }
        jdbcTemplate.update("""
                INSERT INTO session_exercise_notes (session_id, exercise_id, note)
                SELECT s.id, MIN(w.exercise_id), 'note'
                FROM workout_sessions s JOIN workout_sets w ON w.session_id = s.id
                WHERE s.person_id = ? AND s.id % 3 = 0
                GROUP BY s.id""", personId);
    }

    // A brand-new household with one workout -- every e2e household on lower.
    private void seedTiny(long personId, List<Long> exerciseIds) {
        jdbcTemplate.update("""
                INSERT INTO workout_sessions (person_id, started_at, ended_at, last_activity_at, manual)
                VALUES (?, DATEADD(day, -1, SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME(), 0)""", personId);
        for (long exerciseId : exerciseIds) {
            jdbcTemplate.update("""
                    INSERT INTO workout_sets (session_id, person_id, exercise_id, weight, reps, unit)
                    SELECT id, person_id, ?, 100, 5, 'lb' FROM workout_sessions WHERE person_id = ?""",
                    exerciseId, personId);
        }
    }

    // --- sync request bodies ------------------------------------------------------------------

    // What a device that already holds everything sends: every month with its current fingerprint.
    private String heldMonths(Household h) {
        try {
            JsonNode full = syncFull(h);
            Map<String, String> have = new LinkedHashMap<>();
            for (Iterator<Map.Entry<String, JsonNode>> it = full.get("changed").properties().iterator(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> month = it.next();
                have.put(month.getKey(), month.getValue().get("fp").asText());
            }
            return objectMapper.writeValueAsString(Map.of("have", have));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // The sync after logging a set into today's workout: everything held, scoped to that workout.
    private String scopedToLatest(Household h) {
        try {
            JsonNode full = syncFull(h);
            Map<String, String> have = new LinkedHashMap<>();
            JsonNode latest = null;
            for (Iterator<Map.Entry<String, JsonNode>> it = full.get("changed").properties().iterator(); it.hasNext(); ) {
                Map.Entry<String, JsonNode> month = it.next();
                have.put(month.getKey(), month.getValue().get("fp").asText());
                for (JsonNode session : month.getValue().get("sessions")) {
                    if (latest == null || session.get("startedAt").asText().compareTo(latest.get("startedAt").asText()) > 0) {
                        latest = session;
                    }
                }
            }
            return objectMapper.writeValueAsString(Map.of("have", have,
                    "sessions", List.of(latest.get("id").asLong()),
                    "at", List.of(latest.get("startedAt").asText())));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private JsonNode syncFull(Household h) throws Exception {
        return objectMapper.readTree(mockMvc.perform(auth(post("/api/people/" + h.personId() + "/history/sync")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"have\":{}}"), h))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder auth(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request, Household h) {
        return request.header("Authorization", "Bearer " + h.token());
    }
}
