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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// StatsService's set loads must cost in proportion to THIS PERSON's rows, never to the table -- the
// rule HistorySyncCostTest holds History to, and for the same reason: on lower, whose tables hold
// every e2e household ever created, a scan is ruinous while locally it is free. Before V84 these
// loads scanned workout_sets and workout_sessions (GET /prs: 2.9s of database time at five years on
// lower) and looked up every set of an exercise (twice inside every set's save, for its PR check,
// and again for the Log screen's summary).
// docs/architecture/prs-trends-from-history.md, "Baseline" and step 5.
//
// Like HistorySyncCostTest this times nothing. It runs the real endpoints -- a one-workout household
// first, as lower's e2e run does, then a person with years of History among a much larger household
// -- reads the plans SQL Server actually compiled back from Query Store, and requires every read of
// workout_sets and workout_sessions to be a SEEK ON person_id: never a scan, never a key lookup, and
// never a seek by some other key.
//
// That last clause is what makes this hold at a size a test can seed. Without the session's person
// said in the query, SQL Server reaches each set's workout by its id -- here, 30k workouts in, a
// clustered seek per set, which "is a seek"; on lower, 300k in, the same query is a scan of
// workout_sessions (the probe measured both). Checking the seek is ON THE PERSON catches the query
// shape, whichever of the two plans the table's size picks.
//
// ⚠️ If this fails after WorkoutSet or WorkoutSession gains a mapped column, add the column to the
// matching index's INCLUDE list in a new migration (see V84) -- do not relax the assertion.
@AutoConfigureMockMvc
class StatsCostTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, StatsCostTest.class);
    }

    private static final Set<String> SET_TABLES = Set.of("workout_sets", "workout_sessions");

    @Autowired private MockMvc mockMvc;
    @Autowired private TestCodeCache testCodeCache;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private SubscriptionRepository subscriptionRepository;

    @MockitoBean private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private record Household(String token, long personId, long accountId, long exerciseId) {}

    private Household big;
    private Household tiny;

    @BeforeEach
    void setUp() throws Exception {
        List<Long> preloaded = jdbcTemplate.queryForList(
                "SELECT id FROM exercises WHERE account_id IS NULL ORDER BY id", Long.class);

        // Lower's proportions, as HistorySyncCostTest seeds them: a person with years of History is a
        // sliver of every table beside everybody else's. Plan shape depends on the proportions -- and
        // on how sets spread over exercises. Everybody logs against the preloaded catalog, as on
        // lower, a few exercises a workout from a pool. (Put every set on the same three exercises
        // and (person, exercise) really is unselective: the per-exercise load then rightly prefers
        // walking the person's workouts, and this fails on a plan no real household would get.)
        Household other = register("other", preloaded.get(0));
        seedDailyHistory(other.personId(), 30000, preloaded, 4);
        big = register("big", preloaded.get(0));
        seedDailyHistory(big.personId(), 1500, preloaded.subList(0, 24), 4);
        tiny = register("tiny", preloaded.get(0));
        seedDailyHistory(tiny.personId(), 1, preloaded.subList(0, 3), 3);
        for (Household h : List.of(other, big, tiny)) setPlus(h.accountId());

        for (String table : List.of("workout_sessions", "workout_sets", "session_exercise_notes", "exercises")) {
            jdbcTemplate.execute("UPDATE STATISTICS " + table);
        }
    }

    @Test
    void everyStatsLoadSeeksThroughThePersonsOwnRows() throws Exception {
        jdbcTemplate.execute("ALTER DATABASE CURRENT SET QUERY_STORE = ON "
                + "(OPERATION_MODE = READ_WRITE, QUERY_CAPTURE_MODE = ALL)");
        jdbcTemplate.execute("ALTER DATABASE CURRENT SET QUERY_STORE CLEAR");

        // The tiny household first: a plan cached from it is what the big person meets on lower.
        for (Household h : List.of(tiny, big, tiny, big)) callEveryStatsEndpoint(h);

        List<String> violations = new ArrayList<>();
        Set<String> tablesRead = new TreeSet<>();
        int plans = 0;
        int exercisePlans = 0;
        for (Map<String, Object> plan : jdbcTemplate.queryForList("""
                SELECT CAST(p.query_plan AS NVARCHAR(MAX)) AS query_plan,
                       t.query_sql_text AS text
                FROM sys.query_store_plan p
                JOIN sys.query_store_query q ON q.query_id = p.query_id
                JOIN sys.query_store_query_text t ON t.query_text_id = q.query_text_id
                WHERE t.query_sql_text LIKE '%from workout_sets%'
                  AND t.query_sql_text NOT LIKE '%query_store%'""")) {
            String text = (String) plan.get("text");
            String where = text.substring(text.indexOf(" where "));
            // The per-exercise load (inside every set's save, and the Log screen's summary) must seek on
            // the exercise too. Otherwise SQL Server seeks the person's WHOLE set range and filters, or
            // walks every one of their workouts: still the person's rows, but all of them, to answer
            // for one exercise.
            boolean oneExercise = where.contains("ws1_0.exercise_id=");
            plans++;
            if (oneExercise) exercisePlans++;
            // No SQL sort, in any of them. A sort's memory grant is sized from whoever compiled the
            // plan first -- a one-workout household, on lower -- and a five-year person's rows then
            // spill to tempdb: ~4s of database time per overview/export call on lower (2026-09-29).
            // WorkoutSetRepository sorts in Java instead.
            if (((String) plan.get("query_plan")).contains("PhysicalOp=\"Sort\"")) {
                violations.add("a Sort (its memory grant is sized for whoever compiled first) in: "
                        + text.substring(0, 60) + " ..." + where);
            }
            for (Access access : QueryPlans.accesses((String) plan.get("query_plan"))) {
                if (!SET_TABLES.contains(access.table())) continue;
                tablesRead.add(access.table());
                boolean seeksThePerson = access.physicalOp().endsWith("Seek") && !access.lookup()
                        && access.seekColumns().contains("person_id");
                boolean seeksTheExercise = !oneExercise || !access.table().equals("workout_sets")
                        || access.seekColumns().contains("exercise_id");
                if (!seeksThePerson || !seeksTheExercise) {
                    violations.add(access + " in: " + text.substring(0, 60) + " ..." + where);
                }
            }
        }

        // Non-vacuous: the stats loads were captured and both tables were actually read.
        assertTrue(plans >= 2, "expected the per-exercise and whole-person loads; saw " + plans);
        assertTrue(exercisePlans >= 1, "the per-exercise load was not captured");
        assertEquals(new TreeSet<>(SET_TABLES), tablesRead);
        assertTrue(violations.isEmpty(),
                "a stats load reads workout_sets/workout_sessions other than by seeking on the person "
                        + "(cost would follow the table, not the person -- see V84 and WorkoutSetRepository), "
                        + "or sorts in SQL: "
                        + violations);
    }

    // Everything StatsService answers: the whole-person loads (/prs; the overview, whose load is also
    // export's) and the per-exercise one (summary, trend, records).
    private void callEveryStatsEndpoint(Household h) throws Exception {
        String p = "/api/people/" + h.personId();
        String e = p + "/exercises/" + h.exerciseId();
        for (String path : List.of(p + "/prs", p + "/trends/overview?weeks=260", e + "/summary", e + "/records",
                p + "/trends/exercises/" + h.exerciseId() + "?weeks=260")) {
            mockMvc.perform(get(path).header("Authorization", "Bearer " + h.token())).andExpect(status().isOk());
        }
    }

    private Household register(String name, long exerciseId) throws Exception {
        JsonNode r = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache,
                "stats-cost-" + name + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com", name);
        return new Household(r.get("token").asText(), r.get("person").get("id").asLong(),
                r.get("account").get("id").asLong(), exerciseId);
    }

    private void setPlus(long accountId) {
        Subscription subscription = subscriptionRepository.findByAccountId(accountId).orElseThrow();
        subscription.setStatus(SubscriptionStatus.ACTIVE);
        subscription.setPlan(BillingPlan.PLUS);
        subscriptionRepository.save(subscription);
    }

    // One workout a day back from June 2026, `perWorkout` exercises in each, rotating through the pool
    // (so the pool's first exercise -- the one the requests ask about -- recurs every few workouts).
    // Set-based.
    private void seedDailyHistory(long person, int workouts, List<Long> pool, int perWorkout) {
        jdbcTemplate.update("""
                WITH n AS (SELECT TOP (?) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i
                           FROM sys.all_objects a CROSS JOIN sys.all_objects b)
                INSERT INTO workout_sessions (person_id, started_at, ended_at, last_activity_at, manual)
                SELECT ?, DATEADD(day, -CAST(i AS INT), '2026-06-01 10:00'),
                       DATEADD(day, -CAST(i AS INT), '2026-06-01 11:00'),
                       DATEADD(day, -CAST(i AS INT), '2026-06-01 11:00'), 1
                FROM n""", workouts, person);
        for (int slot = 0; slot < perWorkout; slot++) {
            jdbcTemplate.update("""
                    INSERT INTO workout_sets (session_id, person_id, exercise_id, weight, reps, unit)
                    SELECT s.id, s.person_id, ex.id, 100, 5, 'lb'
                    FROM (SELECT id, person_id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS i
                          FROM workout_sessions WHERE person_id = ?) s
                    JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS j
                          FROM exercises WHERE id <= ? AND account_id IS NULL) ex
                      ON ex.j = (s.i * ? + ?) % ?""",
                    person, pool.get(pool.size() - 1), perWorkout, slot, pool.size());
        }
    }
}
