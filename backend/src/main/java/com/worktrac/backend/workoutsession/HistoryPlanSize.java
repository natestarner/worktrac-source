package com.worktrac.backend.workoutsession;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

// How the History sync's two statements get their plans, by the ORDER OF MAGNITUDE of the person's
// History. People differ by four orders of magnitude -- a new household has five sets, a daily
// lifter twenty thousand -- and no single plan is right for both.
//
// What lower measured (docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md), for one
// five-year History (1,827 workouts) on Basic tier:
//   - a plan cached from anyone and REUSED, with runtime feedback on and the class marker in front of
//     the statement: 52-61s per sync at 100% CPU. That held whether the plan was compiled for a
//     five-set e2e household (#345) or for this very person (#349: 6.4s on its first run, ~57s on
//     every run after). Locally, with memory to spare, it never showed.
//   - OPTION (RECOMPILE) for EVERYONE (#348): 3.5-5s, but lower's e2e run -- hundreds of syncs by
//     tiny households -- held the database at 100% CPU for 35 minutes compiling.
//   - RECOMPILE for 100+ workouts only (#350): 3.2-4.1s, but three compiles on every large sync
//     (3.3s per logged set).
//   - THIS (#351): the first sync compiles (6.6s), then 3.1s every time on the cached plan; 1.7s per
//     logged set, 0.6s for a reload that changed nothing; e2e at its lowest CPU of any round.
//
// So every size class gets ONE cached plan, compiled once for someone within a factor of ten of whoever
// uses it -- the class marker is inside the statement's TEXT (see Plan), which is what keeps classes
// apart in both the plan cache and Query Store -- and every mechanism that changes how a cached plan
// runs from one execution to the next is switched off (NO_RUNTIME_FEEDBACK).
// HistorySyncCostTest pins the plan side: each person runs a plan compiled for their class, repeat
// runs compile nothing, and every read is a seek. The feedback side only shows on a memory-starved
// database, so it is pinned by lower's measurements (see the incident), not by a local test.
final class HistoryPlanSize {

    private static final String COUNT = "SELECT COUNT_BIG(*) FROM workout_sessions WHERE person_id = :personId";

    // The marker goes INSIDE the statement, after its leading WITH. Before the statement it separates
    // plan-cache entries (keyed on the batch text) but NOT Query Store queries, which drop a leading
    // comment -- so every size class was one Query Store query, and everything Query Store keys on a
    // query (persisted grant feedback, Azure's automatic plan correction) was shared between a
    // five-set household and a five-year History.
    record Plan(String marker, String suffix) {
        String around(String sql) {
            if (!sql.startsWith("WITH ")) {
                throw new IllegalArgumentException("History statements begin with a CTE: " + sql);
            }
            return "WITH " + marker + sql.substring("WITH ".length()) + suffix;
        }
    }

    private HistoryPlanSize() {
    }

    // Counted over every workout the person has (the Free window does not bound the sets side of
    // either statement), by a seek on their range.
    static Plan forPerson(NamedParameterJdbcTemplate jdbc, long personId) {
        Long workouts = jdbc.queryForObject(COUNT, new MapSqlParameterSource("personId", personId), Long.class);
        return forDigits(digits(workouts == null ? 0 : workouts));
    }

    // Every mechanism by which SQL Server changes how a CACHED plan runs from one execution to the
    // next. With all of them off, a cached plan runs every time exactly as it was compiled.
    static final String NO_RUNTIME_FEEDBACK = "\nOPTION (USE HINT('DISABLE_ROW_MODE_MEMORY_GRANT_FEEDBACK', "
            + "'DISABLE_BATCH_MODE_MEMORY_GRANT_FEEDBACK', 'DISABLE_MEMORY_GRANT_FEEDBACK_PERSISTENCE', "
            + "'DISABLE_CE_FEEDBACK', 'DISABLE_DOP_FEEDBACK', 'DISABLE_BATCH_MODE_ADAPTIVE_JOINS'))";

    static Plan forDigits(int digits) {
        return new Plan("/* history-plan:size-" + digits + " */ ", NO_RUNTIME_FEEDBACK);
    }

    static int digits(long n) {
        return n < 10 ? 1 : 1 + digits(n / 10);
    }
}
