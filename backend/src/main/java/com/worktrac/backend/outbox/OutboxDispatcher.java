package com.worktrac.backend.outbox;

import com.worktrac.backend.config.RunsOnEveryReplica;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executor;

// Delivers outbox rows (see Outbox for how they get there).
//
// ── HOW A ROW MOVES ─────────────────────────────────────────────────────────────────────────────
//   claim    one atomic UPDATE takes a lease (claimed_until) and counts the attempt. UPDLOCK +
//            READPAST make concurrent claimers skip each other's rows instead of waiting on them,
//            so any number of replicas can poll at once and no row is ever delivered by two of them
//            at the same time.
//   deliver  the handler's side effect. It records its own success (the SENT audit row, etc.).
//   success  status SENT, payload nulled.
//   failure  attempts left: back off and release the lease. None left: status FAILED, payload
//            nulled, and the handler's giveUp records the failure where the admin will see it.
//   crash    the lease expires and any replica's next poll reclaims the row.
//
// ── WHAT IS REMOVED AUTOMATICALLY, AND WHAT IS NOT ──────────────────────────────────────────────
//   * A payload is nulled as soon as its row is SENT or FAILED (it may hold a raw code or token).
//   * SENT rows are deleted after app.outbox.sent-retention (30 days).
//   * FAILED rows are NEVER deleted automatically. A row only reaches FAILED after its retries, its
//     handler has recorded why, and the row stays as the record.
//   * Nothing is ever dropped because a replica died: an expired lease is simply reclaimed.
//
// ⚠️ DELIVERY IS AT-LEAST-ONCE. A replica that dies after the provider accepted an email but before
// the row is marked SENT leaves a lease that expires, and the email goes out again. That is the
// accepted trade -- a rare duplicate instead of a silent loss -- and is why one row is one side
// effect (OutboxHandler).
@Component
public class OutboxDispatcher implements SmartInitializingSingleton {

    private static final Logger log = LoggerFactory.getLogger(OutboxDispatcher.class);

    private static final int MAX_ERROR_CHARS = 2000;

    // How long an email row waits when the last minute's quota is used up.
    private static final long PACING_DELAY_SECONDS = 10;

    record Claimed(long id, String handler, String payload, int attempts, String cid) {
    }

    private static final String CLAIM_COLUMNS = "id, handler, payload, attempts, claimed_until, cid";
    private static final String CLAIMABLE = "status = 'PENDING' AND next_attempt_at <= SYSUTCDATETIME() "
            + "AND (claimed_until IS NULL OR claimed_until < SYSUTCDATETIME())";
    private static final String CLAIM_SET = "UPDATE due SET claimed_until = DATEADD(SECOND, ?, SYSUTCDATETIME()), "
            + "attempts = attempts + 1 "
            + "OUTPUT inserted.id, inserted.handler, inserted.payload, inserted.attempts, inserted.cid;";

    private final JdbcTemplate jdbc;
    private final OutboxPayloadCipher cipher;
    private final OutboxProperties properties;
    private final Executor executor;
    private final ObjectProvider<OutboxHandlerProvider> providers;
    private final Map<String, OutboxHandler<?>> handlers = new HashMap<>();
    private volatile boolean pollFailing;

    // Handler providers are looked up lazily (afterSingletonsInstantiated) because they depend on
    // Outbox, which depends on this -- a constructor dependency would be a cycle.
    public OutboxDispatcher(JdbcTemplate jdbc, OutboxPayloadCipher cipher, OutboxProperties properties,
                            @Qualifier("emailTaskExecutor") Executor executor,
                            ObjectProvider<OutboxHandlerProvider> providers) {
        this.jdbc = jdbc;
        this.cipher = cipher;
        this.properties = properties;
        this.executor = executor;
        this.providers = providers;
    }

    @Override
    public void afterSingletonsInstantiated() {
        providers.orderedStream().flatMap(p -> p.outboxHandlers().stream()).forEach(handler -> {
            if (handlers.putIfAbsent(handler.name(), handler) != null) {
                throw new IllegalStateException("Two outbox handlers are named " + handler.name());
            }
        });
    }

    /** Tries one row straight away, off the calling thread. What {@link Outbox} calls after commit. */
    void dispatchSoon(long id) {
        executor.execute(() -> dispatch(id));
    }

    /** Claims and delivers one row, if it is still due and unclaimed. */
    public void dispatch(long id) {
        claim("WITH due AS (SELECT " + CLAIM_COLUMNS + " FROM outbox WITH (UPDLOCK, READPAST, ROWLOCK) "
                        + "WHERE id = ? AND " + CLAIMABLE + ") " + CLAIM_SET,
                id, properties.getClaimDuration().toSeconds())
                .forEach(this::process);
    }

    @Scheduled(fixedDelayString = "${app.outbox.poll-interval:PT5S}", initialDelayString = "${app.outbox.poll-interval:PT5S}")
    @RunsOnEveryReplica("rows are claimed one at a time under UPDLOCK/READPAST, so replicas share the work "
            + "without a lock -- and a lock would leave one replica to drain a burst alone")
    public void pollDue() {
        try {
            List<Claimed> due = claim("WITH due AS (SELECT TOP (?) " + CLAIM_COLUMNS
                            + " FROM outbox WITH (UPDLOCK, READPAST, ROWLOCK) WHERE " + CLAIMABLE
                            + " ORDER BY next_attempt_at) " + CLAIM_SET,
                    properties.getBatchSize(), properties.getClaimDuration().toSeconds());
            due.forEach(this::process);
            if (pollFailing) {
                log.info("Outbox polling recovered");
                pollFailing = false;
            }
        } catch (RuntimeException e) {
            // Database unreachable. Rows are safe in the table and are delivered once it is back;
            // logged once per outage rather than every few seconds.
            if (!pollFailing) {
                log.warn("Outbox polling failed; pending rows will be delivered when the database is back", e);
                pollFailing = true;
            }
        }
    }

    // Every six hours is plenty for a 30-day retention; one replica does it.
    @Scheduled(fixedDelayString = "PT6H", initialDelayString = "PT15M")
    @SchedulerLock(name = "outboxPurgeSent", lockAtLeastFor = "PT5H", lockAtMostFor = "PT5H30M")
    public void purgeSent() {
        int purged = jdbc.update("DELETE FROM outbox WHERE status = 'SENT' "
                + "AND completed_at < DATEADD(SECOND, ?, SYSUTCDATETIME())", -properties.getSentRetention().toSeconds());
        if (purged > 0) {
            log.info("Purged {} sent outbox rows older than {}", purged, properties.getSentRetention());
        }
    }

    private List<Claimed> claim(String sql, Object... args) {
        // No surrounding transaction on these threads, so the claim commits as soon as it runs --
        // which is what makes the lease visible to every other replica straight away.
        return jdbc.query(sql, (rs, n) -> new Claimed(rs.getLong("id"), rs.getString("handler"),
                rs.getString("payload"), rs.getInt("attempts"), rs.getString("cid")), args);
    }

    private void process(Claimed row) {
        String previousCid = MDC.get("cid");
        if (row.cid() != null) {
            MDC.put("cid", row.cid());
        }
        try {
            deliver(row);
        } finally {
            if (previousCid == null) {
                MDC.remove("cid");
            } else {
                MDC.put("cid", previousCid);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private <P> void deliver(Claimed row) {
        OutboxHandler<P> handler = (OutboxHandler<P>) handlers.get(row.handler());
        if (handler == null) {
            log.error("Outbox row {} names unknown handler {}; marking it FAILED", row.id(), row.handler());
            markFailed(row.id(), "No handler named " + row.handler());
            return;
        }

        if (row.handler().startsWith("email.") && emailQuotaUsedUp()) {
            // Not a failure: put the row back, give the attempt back, and try again shortly.
            jdbc.update("UPDATE outbox SET claimed_until = NULL, attempts = attempts - 1, "
                    + "next_attempt_at = DATEADD(SECOND, ?, SYSUTCDATETIME()) WHERE id = ?",
                    PACING_DELAY_SECONDS, row.id());
            log.debug("Outbox row {} ({}) deferred: {} emails already sent in the last minute", row.id(),
                    row.handler(), properties.getEmailSendsPerMinute());
            return;
        }

        P payload;
        try {
            payload = Outbox.JSON.readValue(cipher.decrypt(row.payload()), handler.payloadType());
        } catch (Exception e) {
            // Retrying cannot help a payload that will not decrypt or parse (e.g. APP_JWT_SECRET was
            // rotated while it was pending). Fail it now, loudly.
            log.error("Outbox row {} ({}) has an unreadable payload; marking it FAILED", row.id(), row.handler(), e);
            markFailed(row.id(), "Unreadable payload: " + reason(e));
            return;
        }

        try {
            handler.delivery().deliver(payload);
        } catch (Exception e) {
            String reason = reason(e);
            if (row.attempts() >= properties.getMaxAttempts()) {
                log.error("Outbox row {} ({}) failed attempt {} of {}; giving up", row.id(), row.handler(),
                        row.attempts(), properties.getMaxAttempts(), e);
                markFailed(row.id(), reason);
                giveUpSafely(handler, payload, row, reason);
            } else {
                long delay = properties.backoffBefore(row.attempts() + 1).toSeconds();
                log.warn("Outbox row {} ({}) failed attempt {} of {}; retrying in {}s: {}", row.id(),
                        row.handler(), row.attempts(), properties.getMaxAttempts(), delay, reason);
                markForRetry(row.id(), delay, reason);
            }
            return;
        }

        try {
            jdbc.update("UPDATE outbox SET status = 'SENT', payload = NULL, claimed_until = NULL, "
                    + "completed_at = SYSUTCDATETIME() WHERE id = ?", row.id());
        } catch (RuntimeException e) {
            // The side effect already happened. If this write is lost, the lease expires and the row
            // is delivered again -- the at-least-once trade in this class's header.
            log.error("Outbox row {} ({}) was delivered but could not be marked SENT; it may be delivered again",
                    row.id(), row.handler(), e);
        }
    }

    // Approximate across replicas -- two can both see room for one more -- which can overshoot the
    // quota by a send or two. ACS then throttles that one, and it is retried like any failure.
    private boolean emailQuotaUsedUp() {
        Integer sent = jdbc.queryForObject("SELECT COUNT(*) FROM outbox WHERE status = 'SENT' "
                + "AND completed_at >= DATEADD(MINUTE, -1, SYSUTCDATETIME()) AND handler LIKE 'email.%'", Integer.class);
        return sent != null && sent >= properties.getEmailSendsPerMinute();
    }

    private <P> void giveUpSafely(OutboxHandler<P> handler, P payload, Claimed row, String reason) {
        try {
            handler.giveUp().giveUp(payload, reason + " (after " + row.attempts()
                    + (row.attempts() == 1 ? " attempt)" : " attempts)"));
        } catch (Exception e) {
            log.error("Outbox row {} ({}) failed, and recording that failure also failed", row.id(),
                    row.handler(), e);
        }
    }

    private void markForRetry(long id, long delaySeconds, String reason) {
        jdbc.update("UPDATE outbox SET claimed_until = NULL, "
                + "next_attempt_at = DATEADD(SECOND, ?, SYSUTCDATETIME()), last_error = ? WHERE id = ?",
                delaySeconds, truncate(reason), id);
    }

    private void markFailed(long id, String reason) {
        jdbc.update("UPDATE outbox SET status = 'FAILED', payload = NULL, claimed_until = NULL, "
                + "completed_at = SYSUTCDATETIME(), last_error = ? WHERE id = ?", truncate(reason), id);
    }

    /** The row's current status, for tests and diagnostics. */
    Optional<String> statusOf(long id) {
        return jdbc.query("SELECT status FROM outbox WHERE id = ?", (rs, n) -> rs.getString("status"), id)
                .stream().findFirst();
    }

    // The real reason (an ACS status/code/message, a Stripe error), not just a class name -- this is
    // what the admin portal and the audit trail show.
    static String reason(Exception e) {
        String message = e.getMessage();
        if (message != null && !message.isBlank()) {
            return e.getClass().getSimpleName() + ": " + message;
        }
        return e.getClass().getSimpleName();
    }

    private static String truncate(String reason) {
        return reason.length() <= MAX_ERROR_CHARS ? reason : reason.substring(0, MAX_ERROR_CHARS);
    }
}
