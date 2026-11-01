package com.worktrac.backend.config;

import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.SQLException;

// One "health-metrics" log line per replica per minute: the outbox's backlog and this replica's
// database connection pool. Log Analytics alert rules read it (worktrac-deploy's infra/ Bicep, and
// the KQL in docs/azure-read-only-access.md), which is how the multi-replica alerts work without an
// APM agent in the container.
//
// Why a log line rather than the Application Insights Java agent: measured 2026-11-01, the agent
// added ~7s to a cold start (lower would sit at ~42s against the client's 45s sign-in timeout) and
// ~260 MB of memory -- in production's 0.5 GiB container it pinned memory at 509/512 MB and took
// 203s to start. This costs one indexed query a minute and a few hundred bytes of log.
//
// THE FORMAT IS AN API: the alert rules parse these key=value pairs. Add keys at the end; never
// rename or remove one without changing the alerts in the same release.
//
//   outboxPending               rows waiting to be delivered (all replicas -- the table is shared)
//   outboxOldestPendingSeconds  age of the oldest of them; the "email is stuck" signal. 0 when none
//   outboxFailedLastHour        rows that gave up in the last hour
//   poolActive / poolIdle / poolTotal / poolMax   THIS replica's Hikari pool
//   poolWaiting                 threads on this replica waiting for a connection; above 0 for
//                               minutes means the pool (or the database behind it) is the bottleneck
@Component
public class HealthMetricsLogger {

    private static final Logger log = LoggerFactory.getLogger(HealthMetricsLogger.class);

    record Snapshot(int outboxPending, long outboxOldestPendingSeconds, int outboxFailedLastHour,
                    int poolActive, int poolIdle, int poolTotal, int poolMax, int poolWaiting) {

        String line() {
            return "health-metrics outboxPending=" + outboxPending
                    + " outboxOldestPendingSeconds=" + outboxOldestPendingSeconds
                    + " outboxFailedLastHour=" + outboxFailedLastHour
                    + " poolActive=" + poolActive + " poolIdle=" + poolIdle + " poolTotal=" + poolTotal
                    + " poolMax=" + poolMax + " poolWaiting=" + poolWaiting;
        }
    }

    private final JdbcTemplate jdbc;
    private final DataSource dataSource;

    public HealthMetricsLogger(JdbcTemplate jdbc, DataSource dataSource) {
        this.jdbc = jdbc;
        this.dataSource = dataSource;
    }

    @Scheduled(fixedDelayString = "PT1M", initialDelayString = "PT1M")
    @RunsOnEveryReplica("each replica reports its OWN connection pool; a lock would hide all but one")
    public void logSnapshot() {
        try {
            log.info(snapshot().line());
        } catch (RuntimeException e) {
            // The database is unreachable: the request logs already say so, loudly, and an alert
            // on "no health-metrics line for N minutes" covers a replica that stops reporting.
            log.warn("health-metrics unavailable: {}", e.getMessage());
        }
    }

    Snapshot snapshot() {
        int[] outbox = jdbc.queryForObject(
                "SELECT "
                        + "(SELECT COUNT(*) FROM outbox WHERE status = 'PENDING'), "
                        + "(SELECT ISNULL(DATEDIFF(SECOND, MIN(created_at), SYSUTCDATETIME()), 0) "
                        + "   FROM outbox WHERE status = 'PENDING'), "
                        + "(SELECT COUNT(*) FROM outbox WHERE status = 'FAILED' "
                        + "   AND completed_at >= DATEADD(HOUR, -1, SYSUTCDATETIME()))",
                (rs, n) -> new int[] {rs.getInt(1), rs.getInt(2), rs.getInt(3)});

        int active = -1;
        int idle = -1;
        int total = -1;
        int waiting = -1;
        int max = -1;
        HikariDataSource hikari = unwrapHikari();
        if (hikari != null && hikari.getHikariPoolMXBean() != null) {
            HikariPoolMXBean pool = hikari.getHikariPoolMXBean();
            active = pool.getActiveConnections();
            idle = pool.getIdleConnections();
            total = pool.getTotalConnections();
            waiting = pool.getThreadsAwaitingConnection();
            max = hikari.getMaximumPoolSize();
        }
        return new Snapshot(outbox[0], outbox[1], outbox[2], active, idle, total, max, waiting);
    }

    private HikariDataSource unwrapHikari() {
        try {
            return dataSource.isWrapperFor(HikariDataSource.class) ? dataSource.unwrap(HikariDataSource.class) : null;
        } catch (SQLException e) {
            return null;
        }
    }
}
