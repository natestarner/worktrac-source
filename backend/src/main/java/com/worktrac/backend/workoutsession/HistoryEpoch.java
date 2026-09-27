package com.worktrac.backend.workoutsession;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

// What every History fingerprint is salted with besides the rows it counts: the History FORMAT
// version and the database's IDENTITY. A month's fingerprint (count + SUM(row_version) per table,
// HistoryFingerprints) changes on every write, but two things change what History says without a
// single row changing -- and without this, a device would keep trusting its old copy:
//
//   - FORMAT_VERSION: what History contains or how it is built -- a new field, a column a
//     migration backfills (a metadata-only ADD does not touch row_version), a change to ordering or
//     rounding in HistoryMonths. BUMP IT IN THE SAME CHANGE. Every device then re-downloads its
//     History once, which is exactly right: the content changed everywhere.
//   - the database's creation time: a point-in-time restore or a copy is a NEW database, and its
//     row_version counter restarts from the backup's value, so it hands out numbers devices have
//     already seen. A month could then reach a count and sum a device already holds with different
//     rows in it. A new database is a new epoch, so every device re-downloads once.
//
// Read from sys.databases, which always shows a login its own database; cached for a few minutes so
// it costs nothing per sync. A restore means a connection-string change and a restart anyway.
@Component
public class HistoryEpoch {

    // ⚠️ Bump when History's CONTENT or SHAPE changes without its rows changing (see above).
    // HistoryFingerprintTest#everyFieldHistorySendsIsCoveredByTheFingerprint names this constant.
    public static final int FORMAT_VERSION = 1;

    private static final Duration TTL = Duration.ofMinutes(5);

    private final NamedParameterJdbcTemplate jdbc;
    private volatile String cached;
    private volatile long fetchedAt;

    public HistoryEpoch(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String current() {
        long now = System.nanoTime();
        String value = cached;
        if (value == null || now - fetchedAt > TTL.toNanos()) {
            String created = jdbc.queryForObject(
                    "SELECT CONVERT(VARCHAR(30), create_date, 126) FROM sys.databases WHERE database_id = DB_ID()",
                    new MapSqlParameterSource(), String.class);
            value = "v" + FORMAT_VERSION + "@" + created;
            cached = value;
            fetchedAt = now;
        }
        return value;
    }
}
