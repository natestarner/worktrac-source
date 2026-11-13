package com.worktrac.backend.registrationaudit;

import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

// Safety net for ASYNC EMAIL DISPATCH failure modes across every flow in WATCHED below
// (registration, and member-login invites) --
// originally registration-only failure modes nobody has specifically anticipated
// (the process being killed mid-dispatch, a future bug that stops RegistrationEmailEventListener
// from ever running) -- everything else in this package assumes one of the known code paths
// actually runs and records an outcome; this instead periodically asks the DB directly whether a
// REGISTER_STARTED ever got ANY corresponding email-outcome event, regardless of why not. This is
// what makes "no blind spots" true in practice rather than just in the cases already thought of --
// per-branch try/catch coverage can only guard against a failure mode someone imagined; a
// reconciliation check like this one catches everything else too, which is the entire point of
// the pattern.
//
// GRACE_PERIOD gives the outbox (outbox.OutboxDispatcher) time to finish with a row before a
// still-unresolved dispatch is treated as stuck. A send is normally attempted within a second of the
// commit, but a failing one is retried with backoff for ~9.5 minutes (OutboxProperties) before it
// records FAILED -- so the grace period must outlast every retry, or a row still being retried is
// reported as never dispatched.
// LOOKBACK_WINDOW bounds the candidate query to recent history so this can never rescan the whole
// table as it grows. RESOLVED_TYPES includes REGISTRATION_EMAIL_DISPATCH_MISSING itself so a
// registration already flagged once isn't re-flagged (and re-alerted) on every subsequent run.
@Component
public class RegistrationDispatchWatchdog {

    private static final Logger log = LoggerFactory.getLogger(RegistrationDispatchWatchdog.class);

    static final Duration GRACE_PERIOD = Duration.ofMinutes(15);
    static final Duration LOOKBACK_WINDOW = Duration.ofMinutes(60);

    // How long an ACCEPTED-but-unconfirmed send (EMAIL_SEND_UNCONFIRMED) may go without a delivery
    // report before it is flagged. Reports normally arrive within minutes; during the 2026-11-12
    // ACS slowdown they took up to ~10 hours, and a grace shorter than that would alert on every
    // email that was merely late. The lookback is a whole extra day so a watchdog that misses
    // ticks (a deploy, a scale-in) still reaches every row; these rows are rare, so it costs little.
    static final Duration DELIVERY_REPORT_GRACE = Duration.ofHours(24);
    static final Duration DELIVERY_REPORT_LOOKBACK = Duration.ofHours(24);

    // Every Event Grid outcome EmailDeliveryWebhookController records. Any one of them, for the
    // send's messageId, means ACS told us what happened to it.
    static final Set<RegistrationEventType> DELIVERY_REPORT_TYPES = Set.of(
            RegistrationEventType.EMAIL_DELIVERED,
            RegistrationEventType.EMAIL_BOUNCED,
            RegistrationEventType.EMAIL_DELIVERY_FAILED,
            RegistrationEventType.EMAIL_FILTERED_SPAM,
            RegistrationEventType.EMAIL_SUPPRESSED,
            RegistrationEventType.EMAIL_QUARANTINED);

    /**
     * One row per async email flow this watchdog reconciles.
     *
     * <p>⚠️ <b>GENERALIZED RATHER THAN DUPLICATED, deliberately.</b> Adding a second watchdog for
     * member invites would mean two schedules, two grace periods and two chances for one of them to
     * silently stop running — and "no async mechanism may have a path where 'didn't run' and 'ran
     * fine' look the same from outside" is not satisfied by a mechanism that only covers one flow.
     * A new flow is a row here, not a new class.
     *
     * <p>Each row's {@code resolved} set includes its OWN missing-type, so a flow already flagged
     * once is not re-flagged (and re-alerted) on every subsequent run.
     */
    record Watched(RegistrationEventType started,
                   Set<RegistrationEventType> resolved,
                   RegistrationEventType missing,
                   String description) {
    }

    private static final List<Watched> WATCHED = List.of(
            new Watched(
                    RegistrationEventType.REGISTER_STARTED,
                    Set.of(RegistrationEventType.VERIFICATION_EMAIL_SENT,
                            RegistrationEventType.VERIFICATION_EMAIL_FAILED,
                            RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING),
                    RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING,
                    "VERIFICATION_EMAIL_SENT/FAILED"),
            new Watched(
                    RegistrationEventType.MEMBER_INVITE_STARTED,
                    Set.of(RegistrationEventType.MEMBER_INVITE_EMAIL_SENT,
                            RegistrationEventType.MEMBER_INVITE_EMAIL_FAILED,
                            RegistrationEventType.MEMBER_INVITE_DISPATCH_MISSING),
                    RegistrationEventType.MEMBER_INVITE_DISPATCH_MISSING,
                    "MEMBER_INVITE_EMAIL_SENT/FAILED"));

    private final RegistrationEventRepository repository;
    private final RegistrationAuditService auditService;
    private final Clock clock;

    public RegistrationDispatchWatchdog(RegistrationEventRepository repository,
                                         RegistrationAuditService auditService, Clock clock) {
        this.repository = repository;
        this.auditService = auditService;
        this.clock = clock;
    }

    // One replica per 5-minute interval (SchedulingConfig). Without the lock, two replicas running
    // the same sweep at once would both find the same unresolved REGISTER_STARTED and both record
    // (and alert on) the missing dispatch -- the "already flagged" guard in WATCHED is a read, so it
    // cannot stop two concurrent runs.
    @Scheduled(fixedDelayString = "PT5M", initialDelayString = "PT5M")
    @SchedulerLock(name = "registrationDispatchWatchdog", lockAtLeastFor = "PT4M", lockAtMostFor = "PT4M30S")
    public void checkForMissingDispatch() {
        Instant now = clock.instant();
        Instant windowStart = now.minus(LOOKBACK_WINDOW);
        Instant windowEnd = now.minus(GRACE_PERIOD);

        for (Watched watched : WATCHED) {
            List<RegistrationEvent> started = repository.findByEventTypeAndCreatedAtBetween(
                    watched.started(), windowStart, windowEnd);

            for (RegistrationEvent event : started) {
                boolean resolved = repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(
                        event.getEmail(), watched.resolved(), event.getCreatedAt());
                if (resolved) {
                    continue;
                }
                log.warn("{} for {} started at {} has no email outcome recorded within {}",
                        watched.started(), event.getEmail(), event.getCreatedAt(), GRACE_PERIOD);
                auditService.record(event.getEmail(), watched.missing(),
                        "No " + watched.description() + " recorded within " + GRACE_PERIOD.toMinutes()
                                + " minutes of " + watched.started() + " at " + event.getCreatedAt(),
                        null);
            }
        }

        checkForMissingDeliveryReports(now);
    }

    // The net under EmailService's decision not to resend an accepted-but-unconfirmed send. Such a
    // send's outcome now rests on its Event Grid delivery report, so a report that never comes --
    // ACS failing it without reporting, or the Event Grid subscription broken -- must not leave it
    // looking fine. Same pattern as above: ask the DB whether the outcome ever arrived, whatever
    // the reason it might not have.
    void checkForMissingDeliveryReports(Instant now) {
        Instant windowEnd = now.minus(DELIVERY_REPORT_GRACE);
        Instant windowStart = windowEnd.minus(DELIVERY_REPORT_LOOKBACK);
        List<RegistrationEvent> unconfirmed = repository.findByEventTypeAndCreatedAtBetween(
                RegistrationEventType.EMAIL_SEND_UNCONFIRMED, windowStart, windowEnd);

        for (RegistrationEvent event : unconfirmed) {
            String messageId = event.getMessageId();
            boolean reported = messageId != null
                    && repository.existsByMessageIdAndEventTypeIn(messageId, DELIVERY_REPORT_TYPES);
            if (reported) {
                continue;
            }
            boolean alreadyFlagged = repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(
                    event.getEmail(), Set.of(RegistrationEventType.EMAIL_DELIVERY_REPORT_MISSING),
                    event.getCreatedAt());
            if (alreadyFlagged) {
                continue;
            }
            log.warn("Unconfirmed send to {} (messageId={}) at {} has no delivery report after {}",
                    event.getEmail(), messageId, event.getCreatedAt(), DELIVERY_REPORT_GRACE);
            auditService.record(event.getEmail(), RegistrationEventType.EMAIL_DELIVERY_REPORT_MISSING,
                    messageId != null
                            ? "ACS accepted this email at " + event.getCreatedAt() + " (messageId " + messageId
                                    + ") but no delivery report has arrived in "
                                    + DELIVERY_REPORT_GRACE.toHours() + " hours. Whether it arrived is unknown."
                            : "ACS accepted this email at " + event.getCreatedAt()
                                    + " but its status could not be checked, so no delivery report can be"
                                    + " matched to it. Whether it arrived is unknown.",
                    null, messageId);
        }
    }
}
