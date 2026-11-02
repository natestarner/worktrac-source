package com.worktrac.backend.membership;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.SqlParameterValue;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Types;
import java.time.Duration;
import java.util.List;

// The table every replica reads to learn about cache invalidations made on another replica
// (V86__create_access_invalidations.sql). AccountAccessService writes a row per invalidation;
// AccessInvalidationPoller reads the recent ones on every replica and evicts locally.
//
// ⚠️ ROWS ARE REPLAYED FOR A WINDOW, NOT CONSUMED ONCE, AND THAT IS WHAT MAKES THIS CORRECT.
//
// The insert runs in its OWN transaction (REQUIRES_NEW), so it commits immediately, possibly a moment
// BEFORE the change that caused it commits. A replica that polls in that gap evicts, reloads the
// still-old row and would cache it for 60s. Replaying every row on every poll for REPLAY_WINDOW
// closes that: the next poll after the real commit evicts again. It also makes an IDENTITY gap
// harmless (a "WHERE id > lastSeen" cursor silently skips a row whose transaction commits after a
// higher id's), and makes a replica that starts mid-window pick up what it would have missed.
//
// Why REQUIRES_NEW rather than joining the caller's transaction: some callers invalidate from an
// AFTER_COMMIT listener (AccountPlanChangedListener), where Spring's docs are explicit that a write
// "participates" in the finished transaction and is never committed. One propagation that works from
// every call site beats two that each work from some.
//
// The cost of replaying is a re-read of the affected memberships once per poll for the window --
// invalidations happen a handful of times a day, so that is a few dozen indexed reads, total.
@Component
public class AccessInvalidationLog {

    private static final Logger log = LoggerFactory.getLogger(AccessInvalidationLog.class);

    // Longer than any transaction that invalidates (all are sub-second), short enough that an
    // affected membership is re-read only ~15 times.
    static final Duration REPLAY_WINDOW = Duration.ofSeconds(30);

    record Entry(Long userId, Long accountId) {
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate ownTransaction;

    public AccessInvalidationLog(JdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Records an invalidation for every replica. Never throws: the caller's own change has to
     * succeed whether or not this row lands, and without it other replicas still converge on the
     * cache's 60s TTL, which is what every replica did before this table existed.
     */
    void record(Long userId, Long accountId) {
        try {
            ownTransaction.executeWithoutResult(status -> jdbc.update(
                    "INSERT INTO access_invalidations (user_id, account_id) VALUES (?, ?)",
                    new SqlParameterValue(Types.BIGINT, userId),
                    new SqlParameterValue(Types.BIGINT, accountId)));
        } catch (RuntimeException e) {
            log.warn("Could not record an access invalidation (user {}, account {}); other replicas will "
                    + "pick the change up when their cache entry expires", userId, accountId, e);
        }
    }

    /** Every invalidation recorded inside {@link #REPLAY_WINDOW}, by the database's clock. */
    List<Entry> recent() {
        return jdbc.query(
                "SELECT user_id, account_id FROM access_invalidations "
                        + "WHERE created_at >= DATEADD(SECOND, ?, SYSUTCDATETIME())",
                (rs, n) -> new Entry(
                        (Long) rs.getObject("user_id", Long.class),
                        (Long) rs.getObject("account_id", Long.class)),
                -REPLAY_WINDOW.toSeconds());
    }

    int purgeOlderThan(Duration age) {
        return jdbc.update(
                "DELETE FROM access_invalidations WHERE created_at < DATEADD(SECOND, ?, SYSUTCDATETIME())",
                -age.toSeconds());
    }
}
