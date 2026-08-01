package com.worktrac.backend.registrationaudit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

// Safety net for registration-email-dispatch failure modes nobody has specifically anticipated
// (the process being killed mid-dispatch, a future bug that stops RegistrationEmailEventListener
// from ever running) -- everything else in this package assumes one of the known code paths
// actually runs and records an outcome; this instead periodically asks the DB directly whether a
// REGISTER_STARTED ever got ANY corresponding email-outcome event, regardless of why not. This is
// what makes "no blind spots" true in practice rather than just in the cases already thought of --
// per-branch try/catch coverage can only guard against a failure mode someone imagined; a
// reconciliation check like this one catches everything else too, which is the entire point of
// the pattern.
//
// GRACE_PERIOD gives the normal async pipeline (AsyncConfig's emailTaskExecutor) time to actually
// run before a still-pending dispatch is treated as stuck -- @Async dispatch is typically
// sub-second, but under CallerRunsPolicy backpressure it can briefly queue behind other work.
// LOOKBACK_WINDOW bounds the candidate query to recent history so this can never rescan the whole
// table as it grows. RESOLVED_TYPES includes REGISTRATION_EMAIL_DISPATCH_MISSING itself so a
// registration already flagged once isn't re-flagged (and re-alerted) on every subsequent run.
@Component
public class RegistrationDispatchWatchdog {

    private static final Logger log = LoggerFactory.getLogger(RegistrationDispatchWatchdog.class);

    static final Duration GRACE_PERIOD = Duration.ofMinutes(2);
    static final Duration LOOKBACK_WINDOW = Duration.ofMinutes(30);

    private static final Set<RegistrationEventType> RESOLVED_TYPES = Set.of(
            RegistrationEventType.VERIFICATION_EMAIL_SENT,
            RegistrationEventType.VERIFICATION_EMAIL_FAILED,
            RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING);

    private final RegistrationEventRepository repository;
    private final RegistrationAuditService auditService;
    private final Clock clock;

    public RegistrationDispatchWatchdog(RegistrationEventRepository repository,
                                         RegistrationAuditService auditService, Clock clock) {
        this.repository = repository;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "PT5M", initialDelayString = "PT5M")
    public void checkForMissingDispatch() {
        Instant now = clock.instant();
        Instant windowStart = now.minus(LOOKBACK_WINDOW);
        Instant windowEnd = now.minus(GRACE_PERIOD);

        List<RegistrationEvent> started = repository.findByEventTypeAndCreatedAtBetween(
                RegistrationEventType.REGISTER_STARTED, windowStart, windowEnd);

        for (RegistrationEvent event : started) {
            boolean resolved = repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(
                    event.getEmail(), RESOLVED_TYPES, event.getCreatedAt());
            if (resolved) {
                continue;
            }
            log.warn("Registration for {} started at {} has no verification-email outcome recorded within {}",
                    event.getEmail(), event.getCreatedAt(), GRACE_PERIOD);
            auditService.record(event.getEmail(), RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING,
                    "No VERIFICATION_EMAIL_SENT/FAILED recorded within " + GRACE_PERIOD.toMinutes()
                            + " minutes of REGISTER_STARTED at " + event.getCreatedAt(),
                    null);
        }
    }
}
