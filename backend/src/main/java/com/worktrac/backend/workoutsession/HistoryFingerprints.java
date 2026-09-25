package com.worktrac.backend.workoutsession;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

// One fingerprint per month of a person's visible History, computed by a single aggregate query
// WITHOUT building the month. The History sync (HistorySyncService) returns only the months whose
// fingerprint differs from the one the client holds.
//
// What goes in, and why each one:
//   - sessions, sets and notes of the month: COUNT and SUM(row_version). row_version (V81) is stamped
//     by SQL Server on every INSERT and UPDATE, and every new value is greater than every existing
//     one, so for any change: an insert or update adds a value larger than anything it removed (the
//     sum rises), a delete lowers the count, and a change that keeps the count -- delete one, add one
//     -- still raises the sum, because everything added is newer than everything removed. SUM, not
//     MAX: a transaction that commits late holds a value lower than rows already visible, which MAX
//     would never notice and SUM does.
//   - the exercises the month's sets name: SUM of their DISTINCT row_version. History carries each
//     entry's exercise name, so a rename changes every month that logged it, for every person.
//   - the FULL-HISTORY FLAG, not the Free-tier floor. The floor is `now - 90 days` and moves every
//     instant; hashing it would change every Free month on every request. Instead only rows the
//     floor admits are aggregated, so a session aging out of the window lowers its month's count.
//     The one way rows can ENTER the visible set without a write is an upgrade -- which flips the
//     flag and so changes every month.
//
// A month is the UTC calendar month of a session's started_at (hibernate.jdbc.time_zone is UTC, so
// the stored value is UTC; CONVERT style 126 is ISO 8601 and CHAR(7) keeps 'yyyy-mm'). The client
// never computes one. A month appears if the person has any visible session in it, including one
// with no sets (History does not show that session, so the month is simply empty).
//
// Everything is scoped to the person through workout_sessions.person_id, and sets additionally
// through their own person_id so the covering index (V82) applies.
//
// ⚠️ If History ever reads a new column or table, it MUST be folded in here, or a change to it will
// be answered with "unchanged" and the device keeps the old value until the daily full sync.
// HistoryFingerprintTest enumerates History's fields and fails until a new one is declared covered.
@Repository
public class HistoryFingerprints {

    private static final String AGGREGATE = """
            WITH vs AS (
                SELECT id, row_version, CONVERT(CHAR(7), started_at, 126) AS month
                FROM workout_sessions
                WHERE person_id = :personId %s
            ),
            sess_agg AS (
                SELECT month, COUNT_BIG(*) AS n, SUM(CAST(CAST(row_version AS BIGINT) AS DECIMAL(38,0))) AS rv
                FROM vs GROUP BY month
            ),
            set_agg AS (
                SELECT vs.month, COUNT_BIG(*) AS n, SUM(CAST(CAST(s.row_version AS BIGINT) AS DECIMAL(38,0))) AS rv
                FROM workout_sets s JOIN vs ON vs.id = s.session_id
                WHERE s.person_id = :personId
                GROUP BY vs.month
            ),
            note_agg AS (
                SELECT vs.month, COUNT_BIG(*) AS n, SUM(CAST(CAST(sen.row_version AS BIGINT) AS DECIMAL(38,0))) AS rv
                FROM session_exercise_notes sen JOIN vs ON vs.id = sen.session_id
                GROUP BY vs.month
            ),
            ex_agg AS (
                SELECT month, SUM(CAST(CAST(rv AS BIGINT) AS DECIMAL(38,0))) AS rv
                FROM (
                    SELECT DISTINCT vs.month, e.id, e.row_version AS rv
                    FROM workout_sets s
                    JOIN vs ON vs.id = s.session_id
                    JOIN exercises e ON e.id = s.exercise_id
                    WHERE s.person_id = :personId
                ) d
                GROUP BY month
            )
            SELECT sa.month, sa.n AS sess_n, sa.rv AS sess_rv,
                   ISNULL(ta.n, 0) AS set_n, ISNULL(ta.rv, 0) AS set_rv,
                   ISNULL(na.n, 0) AS note_n, ISNULL(na.rv, 0) AS note_rv,
                   ISNULL(ea.rv, 0) AS ex_rv
            FROM sess_agg sa
            LEFT JOIN set_agg ta ON ta.month = sa.month
            LEFT JOIN note_agg na ON na.month = sa.month
            LEFT JOIN ex_agg ea ON ea.month = sa.month
            ORDER BY sa.month DESC
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public HistoryFingerprints(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // Month ('yyyy-mm') -> fingerprint, newest month first. `floor` is SubscriptionService#historyFloor
    // for the person's account: null admits everything (and marks the full-history flag).
    public Map<String, String> forPerson(long personId, Instant floor) {
        MapSqlParameterSource params = new MapSqlParameterSource("personId", personId);
        String sql;
        if (floor == null) {
            sql = AGGREGATE.formatted("");
        } else {
            sql = AGGREGATE.formatted("AND started_at >= :floor");
            // As a UTC LocalDateTime, not a java.sql.Timestamp: started_at is stored in UTC by
            // Hibernate (jdbc.time_zone), but a Timestamp here would be shifted by the JVM's own zone.
            params.addValue("floor", LocalDateTime.ofInstant(floor, ZoneOffset.UTC));
        }
        Map<String, String> fingerprints = new LinkedHashMap<>();
        jdbc.query(sql, params, rs -> {
            fingerprints.put(rs.getString("month"), of(floor == null,
                    rs.getLong("sess_n"), rs.getBigDecimal("sess_rv").toBigIntegerExact(),
                    rs.getLong("set_n"), rs.getBigDecimal("set_rv").toBigIntegerExact(),
                    rs.getLong("note_n"), rs.getBigDecimal("note_rv").toBigIntegerExact(),
                    rs.getBigDecimal("ex_rv").toBigIntegerExact()));
        });
        return fingerprints;
    }

    // The one definition of a month's fingerprint from its totals. HistoryMonths computes the same
    // totals from the rows it loads, so the fingerprint it hands the client describes exactly the
    // content beside it; HistoryFingerprintTest pins that the two always agree.
    static String of(boolean fullHistory, long sessions, BigInteger sessionVersions, long sets,
                     BigInteger setVersions, long notes, BigInteger noteVersions, BigInteger exerciseVersions) {
        return hash(String.join("|", fullHistory ? "full" : "window",
                Long.toString(sessions), sessionVersions.toString(),
                Long.toString(sets), setVersions.toString(),
                Long.toString(notes), noteVersions.toString(),
                exerciseVersions.toString()));
    }

    // 128 bits of SHA-256, base64url: short enough that a client holding years of months sends a
    // small request, and a collision is not a practical concern at 2^-64 birthday odds per person.
    private static String hash(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
            byte[] truncated = new byte[16];
            System.arraycopy(digest, 0, truncated, 0, 16);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(truncated);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required of every JVM", e);
        }
    }
}
