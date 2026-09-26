package com.worktrac.backend.workoutsession;

import com.worktrac.backend.stats.SetSummaryDto;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

// Builds a person's History, month by month, with each month's fingerprint derived from EXACTLY the
// rows that built it -- the one builder behind both GET /history and the History sync.
//
// ONE statement, on purpose. Under READ_COMMITTED_SNAPSHOT every statement reads one consistent
// snapshot, so a single statement can never see a set without its workout, a workout that moved
// months halfway through, or a set that was added and deleted again while the read was in flight.
// Three separate loads (sessions, then sets, then notes) could -- and a month built from them would
// be paired with a fingerprint describing a state that never existed, which the client would then
// trust until something else changed that month.
//
// The fingerprint here and HistoryFingerprints' aggregate are two computations of one definition
// (HistoryFingerprints#of); HistoryFingerprintTest asserts they agree after every write it makes.
//
// Rows are only ever the person's own: workout_sessions.person_id scopes every branch, and sets are
// additionally filtered by their own person_id.
//
// ⚠️ Cost must follow the person, never the table -- see HistoryFingerprints for the whole rule and
// why the join hints are load-bearing. Here that means: the person's DISTINCT exercises are looked up
// once each (person_exercises) rather than once per set, which against a lower-sized exercises table
// was 57,302 page reads for one five-year History and is now 24; and notes are reached by seek from
// the person's own sessions rather than by a pass over the notes index. HistoryPlanSize decides its plan:
// compiled per execution for a large History, one cached plan per size class for a small one.
@Repository
public class HistoryMonths {

    public record Month(String fingerprint, List<HistorySessionDto> sessions) {}

    // Typed NULLs in the first branch: UNION ALL takes each column's type from all branches, and an
    // untyped NULL there would be an INT that the later NVARCHAR values fail to convert into.
    //
    // ONE statement, two ways to reach the sets (%2$s, %3$s) -- see ALL_SETS and RANGE_SETS. %1$s is
    // the sessions' date filter.
    private static final String LOAD = """
            WITH vs AS (
                SELECT id, started_at, ended_at, manual, row_version, CONVERT(CHAR(7), started_at, 126) AS month
                FROM workout_sessions
                WHERE person_id = :personId %1$s
            ),
            person_exercises AS (
                SELECT e.id, e.name, e.row_version
                FROM (%2$s) d
                INNER LOOP JOIN exercises e ON e.id = d.exercise_id
            )
            SELECT CAST('S' AS CHAR(1)) AS kind, vs.month, vs.id AS session_id,
                   vs.started_at, vs.ended_at, vs.manual, CAST(vs.row_version AS BIGINT) AS rv,
                   CAST(NULL AS BIGINT) AS set_id, CAST(NULL AS BIGINT) AS exercise_id,
                   CAST(NULL AS NVARCHAR(200)) AS exercise_name, CAST(NULL AS BIGINT) AS exercise_rv,
                   CAST(NULL AS DECIMAL(6,2)) AS weight, CAST(NULL AS INT) AS reps,
                   CAST(NULL AS INT) AS duration_seconds, CAST(NULL AS NVARCHAR(2)) AS unit,
                   CAST(NULL AS DATETIME2) AS created_at, CAST(NULL AS NVARCHAR(1000)) AS note
            FROM vs
            UNION ALL
            SELECT 'T', vs.month, s.session_id,
                   NULL, NULL, NULL, CAST(s.row_version AS BIGINT),
                   s.id, s.exercise_id, e.name, CAST(e.row_version AS BIGINT),
                   s.weight, s.reps, s.duration_seconds, s.unit, s.created_at, NULL
            FROM %3$s
            INNER HASH JOIN person_exercises e ON e.id = s.exercise_id
            WHERE s.person_id = :personId
            UNION ALL
            SELECT 'N', vs.month, sen.session_id,
                   NULL, NULL, NULL, CAST(sen.row_version AS BIGINT),
                   NULL, sen.exercise_id, NULL, NULL,
                   NULL, NULL, NULL, NULL, NULL, sen.note
            FROM vs INNER LOOP JOIN session_exercise_notes sen ON sen.session_id = vs.id
            """;

    // The WHOLE History (GET /history, a full sync): every one of the person's sets in one pass of
    // their index range, matched to their workouts in memory. For five years that is one read of
    // ~20k index entries -- far cheaper than ~1,800 separate per-workout lookups.
    private static final String[] ALL_SETS = {
            "SELECT DISTINCT exercise_id FROM workout_sets WHERE person_id = :personId",
            "vs INNER HASH JOIN workout_sets s ON s.session_id = vs.id",
    };

    // A RANGE of months (a sync after a write): only the range's own workouts' sets, one index seek
    // per workout on (person_id, session_id). The all-sets pass above, used here, read a five-year
    // History's every set to return one month's few hundred -- which made every per-set sync cost
    // as much as the whole History. The exercises come from the range's sets for the same reason.
    // A wide range (an old month edited alongside this one) costs more seeks, but still only this
    // person's rows, never the table's.
    private static final String[] RANGE_SETS = {
            "SELECT DISTINCT rs.exercise_id FROM vs INNER LOOP JOIN workout_sets rs"
                    + " ON rs.person_id = :personId AND rs.session_id = vs.id",
            "vs INNER LOOP JOIN workout_sets s ON s.person_id = :personId AND s.session_id = vs.id",
    };

    // The statement for a load, before its plan marker (HistoryPlanSize). Package-private so
    // HistoryFingerprintTest can check both shapes read the tables the fingerprint covers.
    static String sql(boolean range, String where) {
        String[] sets = range ? RANGE_SETS : ALL_SETS;
        return LOAD.formatted(where, sets[0], sets[1]);
    }

    private final NamedParameterJdbcTemplate jdbc;

    public HistoryMonths(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // Every month the person has a visible workout in, within [from, to) when given (either may be
    // null for open-ended), newest first. `floor` is SubscriptionService#historyFloor.
    public Map<String, Month> load(long personId, Instant floor, Instant from, Instant to) {
        StringBuilder where = new StringBuilder();
        MapSqlParameterSource params = new MapSqlParameterSource("personId", personId);
        // UTC LocalDateTimes, not java.sql.Timestamps: started_at is stored in UTC (Hibernate's
        // jdbc.time_zone), and a Timestamp would be shifted by the JVM's own zone on the way in.
        if (floor != null) {
            where.append(" AND started_at >= :floor");
            params.addValue("floor", utc(floor));
        }
        if (from != null) {
            where.append(" AND started_at >= :from");
            params.addValue("from", utc(from));
        }
        if (to != null) {
            where.append(" AND started_at < :to");
            params.addValue("to", utc(to));
        }
        return query(personId, floor, where.toString(), params, from != null || to != null);
    }

    // Exactly these months ('yyyy-mm' as YearMonths, UTC), each as its own range -- a scoped sync's
    // load (WorkoutSessionService#syncHistory). Separate ranges rather than one spanning them, so two
    // far-apart months never drag in every month between. Same statement, so the same snapshot
    // guarantee and the same fingerprint-from-its-own-rows pairing as every other load.
    public Map<String, Month> loadMonths(long personId, Instant floor, Collection<YearMonth> months) {
        if (months.isEmpty()) {
            return Map.of();
        }
        StringBuilder where = new StringBuilder();
        MapSqlParameterSource params = new MapSqlParameterSource("personId", personId);
        if (floor != null) {
            where.append(" AND started_at >= :floor");
            params.addValue("floor", utc(floor));
        }
        List<String> ranges = new ArrayList<>();
        int i = 0;
        for (YearMonth month : months) {
            ranges.add("(started_at >= :from" + i + " AND started_at < :to" + i + ")");
            params.addValue("from" + i, month.atDay(1).atStartOfDay());
            params.addValue("to" + i, month.plusMonths(1).atDay(1).atStartOfDay());
            i++;
        }
        where.append(" AND (").append(String.join(" OR ", ranges)).append(")");
        return query(personId, floor, where.toString(), params, true);
    }

    // The month each of these workouts is in NOW -- only the person's own; an id that is not theirs,
    // or no longer exists, contributes nothing. By the same CONVERT the loads use, so the database,
    // not Java, decides the month. A seek on the primary key per id; `ids` is bounded by the request.
    public List<YearMonth> monthsOf(long personId, Collection<Long> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.queryForList("""
                        SELECT DISTINCT CONVERT(CHAR(7), started_at, 126)
                        FROM workout_sessions
                        WHERE person_id = :personId AND id IN (:ids)""",
                new MapSqlParameterSource("personId", personId).addValue("ids", ids), String.class)
                .stream().map(YearMonth::parse).toList();
    }

    private Map<String, Month> query(long personId, Instant floor, String where, MapSqlParameterSource params,
                                     boolean range) {
        Map<Long, SessionRow> sessions = new HashMap<>();
        List<SetRow> sets = new ArrayList<>();
        List<NoteRow> notes = new ArrayList<>();
        jdbc.query(HistoryPlanSize.forPerson(jdbc, personId).around(sql(range, where)), params, rs -> {
            String month = rs.getString("month");
            long sessionId = rs.getLong("session_id");
            BigInteger rv = BigInteger.valueOf(rs.getLong("rv"));
            switch (rs.getString("kind")) {
                case "S" -> sessions.put(sessionId, new SessionRow(sessionId, month,
                        instant(rs.getObject("started_at", LocalDateTime.class)),
                        instant(rs.getObject("ended_at", LocalDateTime.class)),
                        rs.getBoolean("manual"), rv));
                case "T" -> sets.add(new SetRow(sessionId, month, rs.getLong("set_id"),
                        rs.getLong("exercise_id"), rs.getString("exercise_name"),
                        BigInteger.valueOf(rs.getLong("exercise_rv")),
                        rs.getBigDecimal("weight"), rs.getInt("reps"),
                        rs.getObject("duration_seconds", Integer.class), rs.getString("unit"),
                        instant(rs.getObject("created_at", LocalDateTime.class)), rv));
                case "N" -> notes.add(new NoteRow(sessionId, month, rs.getLong("exercise_id"),
                        rs.getString("note"), rv));
                default -> throw new IllegalStateException("Unknown History row kind");
            }
        });
        return build(floor == null, sessions, sets, notes);
    }

    private static Map<String, Month> build(boolean fullHistory, Map<Long, SessionRow> sessions,
                                            List<SetRow> sets, List<NoteRow> notes) {
        // Created-at order within a session, id breaking ties -- the order sets were logged in.
        sets.sort(Comparator.comparing(SetRow::createdAt).thenComparingLong(SetRow::id));
        Map<Long, List<SetRow>> setsBySession = new HashMap<>();
        for (SetRow set : sets) {
            setsBySession.computeIfAbsent(set.sessionId(), k -> new ArrayList<>()).add(set);
        }
        Map<Long, Map<Long, String>> notesBySession = new HashMap<>();
        for (NoteRow note : notes) {
            notesBySession.computeIfAbsent(note.sessionId(), k -> new HashMap<>()).put(note.exerciseId(), note.note());
        }

        Map<String, Totals> totals = new TreeMap<>(Comparator.reverseOrder());
        for (SessionRow session : sessions.values()) {
            totals.computeIfAbsent(session.month(), m -> new Totals()).addSession(session.rv());
        }
        for (SetRow set : sets) {
            totals.get(set.month()).addSet(set);
        }
        for (NoteRow note : notes) {
            totals.get(note.month()).addNote(note.rv());
        }

        // Newest first; ties on started_at broken by id so the order is stable across reads.
        List<SessionRow> ordered = new ArrayList<>(sessions.values());
        ordered.sort(Comparator.comparing(SessionRow::startedAt).thenComparingLong(SessionRow::id).reversed());
        Map<String, List<HistorySessionDto>> byMonth = new HashMap<>();
        for (SessionRow session : ordered) {
            List<SetRow> sessionSets = setsBySession.get(session.id());
            // A workout with no sets (an abandoned "log a past workout") is not a History row --
            // but it still counts toward its month's fingerprint, so creating one is noticed.
            if (sessionSets == null) continue;
            byMonth.computeIfAbsent(session.month(), m -> new ArrayList<>())
                    .add(toDto(session, sessionSets, notesBySession.getOrDefault(session.id(), Map.of())));
        }

        Map<String, Month> months = new LinkedHashMap<>();
        totals.forEach((month, t) -> months.put(month,
                new Month(t.fingerprint(fullHistory), byMonth.getOrDefault(month, List.of()))));
        return months;
    }

    // Exercises in the order they were first logged in the workout, each with its sets in logged
    // order and its session note, if any.
    private static HistorySessionDto toDto(SessionRow session, List<SetRow> sessionSets, Map<Long, String> notes) {
        Map<Long, List<SetRow>> byExercise = new LinkedHashMap<>();
        for (SetRow set : sessionSets) {
            byExercise.computeIfAbsent(set.exerciseId(), k -> new ArrayList<>()).add(set);
        }
        List<HistoryEntryDto> entries = byExercise.values().stream()
                .map(exerciseSets -> new HistoryEntryDto(
                        exerciseSets.get(0).exerciseId(),
                        exerciseSets.get(0).exerciseName(),
                        exerciseSets.stream()
                                .map(s -> new SetSummaryDto(s.weight(), s.reps(), s.durationSeconds(), s.unit()))
                                .toList(),
                        notes.get(exerciseSets.get(0).exerciseId())))
                .toList();
        return new HistorySessionDto(session.id(), session.startedAt(), session.endedAt(), session.manual(), entries);
    }

    private static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static Instant instant(LocalDateTime utc) {
        return utc == null ? null : utc.toInstant(ZoneOffset.UTC);
    }

    // The same totals HistoryFingerprints aggregates in SQL, summed from the loaded rows.
    private static final class Totals {
        private long sessions;
        private BigInteger sessionVersions = BigInteger.ZERO;
        private long sets;
        private BigInteger setVersions = BigInteger.ZERO;
        private long notes;
        private BigInteger noteVersions = BigInteger.ZERO;
        private final Map<Long, BigInteger> exerciseVersions = new HashMap<>();

        void addSession(BigInteger rv) {
            sessions++;
            sessionVersions = sessionVersions.add(rv);
        }

        void addSet(SetRow set) {
            sets++;
            setVersions = setVersions.add(set.rv());
            exerciseVersions.put(set.exerciseId(), set.exerciseRv());
        }

        void addNote(BigInteger rv) {
            notes++;
            noteVersions = noteVersions.add(rv);
        }

        String fingerprint(boolean fullHistory) {
            BigInteger exercises = exerciseVersions.values().stream().reduce(BigInteger.ZERO, BigInteger::add);
            return HistoryFingerprints.of(fullHistory, sessions, sessionVersions, sets, setVersions,
                    notes, noteVersions, exercises);
        }
    }

    private record SessionRow(long id, String month, Instant startedAt, Instant endedAt, boolean manual, BigInteger rv) {}

    private record SetRow(long sessionId, String month, long id, long exerciseId, String exerciseName,
                          BigInteger exerciseRv, BigDecimal weight, int reps, Integer durationSeconds,
                          String unit, Instant createdAt, BigInteger rv) {}

    private record NoteRow(long sessionId, String month, long exerciseId, String note, BigInteger rv) {}
}
