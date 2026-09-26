package com.worktrac.backend.workoutsession;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

// Gives the History sync's statements one cached plan per ORDER OF MAGNITUDE of History, instead of
// one plan for everybody.
//
// SQL Server caches a statement's plan against its exact text, compiled for whoever ran it first.
// People differ by four orders of magnitude -- a new household has five sets, a daily lifter twenty
// thousand -- and a plan built for one is ruinous for the other. On lower, the first to run is
// always an e2e household: a five-year History then ran a plan compiled for five rows (memory grants
// that spilled, month joins as nested loops re-running each aggregate once per month) and took ~50s
// per sync on Basic tier. See docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md.
//
// The comment this returns is part of the statement's TEXT, so each size class gets its own cached
// plan, compiled for a person of that size -- within a factor of ten of whoever uses it.
//
// ⚠️ Not OPTION (RECOMPILE). That was tried: it gives every execution the right plan, but compiling
// these statements costs so much on Basic tier that lower's e2e run -- hundreds of syncs -- held
// the database at 100% CPU for 35 minutes. Plans must be compiled once per size class, not per call.
// HistorySyncCostTest pins both halves: the big person's plan was compiled for them, and running
// again compiles nothing.
final class HistoryPlanSize {

    private static final String COUNT = "SELECT COUNT_BIG(*) FROM workout_sessions WHERE person_id = :personId";

    private HistoryPlanSize() {
    }

    // `/* history-plan:size-N */ `, where N is the number of decimal digits in the person's workout
    // count: 1 for under 10, 2 for under 100, and so on. Counted over every workout the person has
    // (the Free window does not bound the sets side of either statement), by a seek on their range.
    static String comment(NamedParameterJdbcTemplate jdbc, long personId) {
        Long workouts = jdbc.queryForObject(COUNT, new MapSqlParameterSource("personId", personId), Long.class);
        return "/* history-plan:size-" + digits(workouts == null ? 0 : workouts) + " */ ";
    }

    static int digits(long n) {
        return n < 10 ? 1 : 1 + digits(n / 10);
    }
}
