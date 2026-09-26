package com.worktrac.backend.workoutsession;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

// How the History sync's two statements get their plans, by the ORDER OF MAGNITUDE of the person's
// History. People differ by four orders of magnitude -- a new household has five sets, a daily
// lifter twenty thousand -- and no single plan is right for both.
//
// What lower measured (docs/incidents/2026-09-25-history-full-sync-pegged-lower-db.md), for one
// five-year History (1,827 workouts) on Basic tier:
//   - a plan cached from anyone and REUSED: 52-61s per sync at 100% CPU. That held whether the plan
//     was compiled for a five-set e2e household (#345) or for this very person (#349, whose first,
//     freshly compiled run took 6.4s and every later one ~57s). The likeliest cause is memory grant
//     feedback shrinking the reused plan's grant; locally, with memory to spare, it never shows.
//   - a plan compiled for THIS execution (OPTION (RECOMPILE), #348): 3.5-5s.
//   - OPTION (RECOMPILE) for EVERYONE (#348): lower's e2e run -- hundreds of syncs by tiny households
//     -- held the database at 100% CPU for 35 minutes compiling.
//
// So: a History of RECOMPILE_FROM_DIGITS digits or more is compiled per execution (few people, and
// each sync is worth a compile); anything smaller gets one cached plan per size class, compiled once.
// The size-class comment is part of the statement's TEXT, which is what keeps a small class's cached
// plan from being shared with any other class. HistorySyncCostTest pins all three: the big person's
// plans are compiled for them, a small person's plans are reused rather than recompiled, and every
// read is a seek.
final class HistoryPlanSize {

    // 100 workouts and up -- two orders of magnitude above an e2e household, below any real lifter's
    // first year.
    static final int RECOMPILE_FROM_DIGITS = 3;

    private static final String COUNT = "SELECT COUNT_BIG(*) FROM workout_sessions WHERE person_id = :personId";

    record Plan(String prefix, String suffix) {
        String around(String sql) {
            return prefix + sql + suffix;
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

    static Plan forDigits(int digits) {
        return new Plan("/* history-plan:size-" + digits + " */ ",
                digits >= RECOMPILE_FROM_DIGITS ? "\nOPTION (RECOMPILE)" : "");
    }

    static int digits(long n) {
        return n < 10 ? 1 : 1 + digits(n / 10);
    }
}
