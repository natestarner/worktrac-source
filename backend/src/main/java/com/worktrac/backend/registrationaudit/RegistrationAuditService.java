package com.worktrac.backend.registrationaudit;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Set;

// Persists one row per registration lifecycle event, independent of whatever transaction the
// caller is in. REQUIRES_NEW is essential, not incidental: RegistrationService's confirmEmail
// records a wrong-code/expired/locked failure and then throws to report it to the caller (see
// its own noRollbackFor comment for why that method's outer transaction survives) -- but other
// callers (register's duplicate-email/rate-limit checks, resendCode, confirmEmail's
// not-found/expired/locked branches) throw from a transaction that is NOT marked
// noRollbackFor, so without REQUIRES_NEW the audit row recording the very failure would be
// rolled back along with everything else, making failures the one thing this table never
// actually captured.
//
// All three overloads below carry @Transactional(REQUIRES_NEW), not just the 5-arg one --
// Spring's transactional advice is applied via a proxy around the whole bean, which only
// intercepts calls arriving from OUTSIDE the class. The 3-arg/4-arg overloads delegating to the
// 5-arg one via a plain `record(...)` self-call bypass that proxy entirely, so if only the
// 5-arg method were annotated, every call site using a shorthand overload (nearly all of them)
// would silently run inside whatever transaction was already active -- exactly the failure mode
// this class exists to prevent (confirmed by a real test failure without this: audit rows for
// register()'s duplicate-email/rate-limited paths, and confirmEmail's not-found/expired/locked
// paths, were missing after the request rolled back).
@Service
public class RegistrationAuditService {

    private static final int MAX_DETAIL_LENGTH = 1000;

    private static final Set<RegistrationEventType> ALERTABLE = Set.of(
            RegistrationEventType.CONFIRM_SUCCESS,
            RegistrationEventType.VERIFICATION_EMAIL_FAILED,
            RegistrationEventType.SUCCESS_EMAIL_FAILED,
            RegistrationEventType.PASSWORD_RESET_EMAIL_FAILED,
            RegistrationEventType.PASSWORD_RESET_SUCCESS_EMAIL_FAILED,
            RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING,
            RegistrationEventType.EMAIL_BOUNCED,
            RegistrationEventType.EMAIL_DELIVERY_FAILED,
            RegistrationEventType.EMAIL_FILTERED_SPAM,
            RegistrationEventType.EMAIL_SUPPRESSED,
            RegistrationEventType.EMAIL_QUARANTINED);

    private final RegistrationEventRepository repository;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;

    public RegistrationAuditService(RegistrationEventRepository repository,
                                     ApplicationEventPublisher eventPublisher, Clock clock) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String email, RegistrationEventType eventType, String detail, String ipAddress,
                        String messageId) {
        String truncatedDetail = truncate(detail);
        repository.save(new RegistrationEvent(email, eventType, truncatedDetail, ipAddress, messageId,
                clock.instant()));

        if (ALERTABLE.contains(eventType)) {
            eventPublisher.publishEvent(new RegistrationAlertEvent(eventType, email, truncatedDetail));
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String email, RegistrationEventType eventType, String detail, String ipAddress) {
        record(email, eventType, detail, ipAddress, null);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String email, RegistrationEventType eventType, String detail) {
        record(email, eventType, detail, null, null);
    }

    private String truncate(String detail) {
        if (detail == null) return null;
        return detail.length() > MAX_DETAIL_LENGTH ? detail.substring(0, MAX_DETAIL_LENGTH) : detail;
    }
}
