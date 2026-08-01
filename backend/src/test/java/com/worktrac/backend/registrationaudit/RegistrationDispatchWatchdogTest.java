package com.worktrac.backend.registrationaudit;

import com.worktrac.backend.support.MutableClock;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Pure unit test (no Spring context, no DB) for the safety-net reconciliation job: it must flag
// a REGISTER_STARTED with no corresponding email-outcome event after the grace period, must NOT
// flag one that resolved normally, and must NOT re-flag one it has already flagged (which would
// otherwise re-alert on every 5-minute tick for the same stuck registration forever).
class RegistrationDispatchWatchdogTest {

    private RegistrationEvent registerStartedAt(String email, Instant createdAt) {
        return new RegistrationEvent(email, RegistrationEventType.REGISTER_STARTED, null, null, null, createdAt);
    }

    @Test
    void flagsARegistrationWithNoEmailOutcomeAfterTheGracePeriod() {
        RegistrationEventRepository repository = mock(RegistrationEventRepository.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        MutableClock clock = new MutableClock();
        RegistrationDispatchWatchdog watchdog = new RegistrationDispatchWatchdog(repository, auditService, clock);

        Instant startedAt = clock.instant().minus(RegistrationDispatchWatchdog.GRACE_PERIOD).minusSeconds(1);
        RegistrationEvent started = registerStartedAt("stuck@example.com", startedAt);

        when(repository.findByEventTypeAndCreatedAtBetween(eq(RegistrationEventType.REGISTER_STARTED), any(), any()))
                .thenReturn(List.of(started));
        when(repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(eq("stuck@example.com"),
                anyCollection(), eq(startedAt)))
                .thenReturn(false);

        watchdog.checkForMissingDispatch();

        verify(auditService).record(eq("stuck@example.com"),
                eq(RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING), anyString(), any());
    }

    @Test
    void doesNotFlagARegistrationThatAlreadyHasAnEmailOutcome() {
        RegistrationEventRepository repository = mock(RegistrationEventRepository.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        MutableClock clock = new MutableClock();
        RegistrationDispatchWatchdog watchdog = new RegistrationDispatchWatchdog(repository, auditService, clock);

        Instant startedAt = clock.instant().minus(RegistrationDispatchWatchdog.GRACE_PERIOD).minusSeconds(1);
        RegistrationEvent started = registerStartedAt("resolved@example.com", startedAt);

        when(repository.findByEventTypeAndCreatedAtBetween(eq(RegistrationEventType.REGISTER_STARTED), any(), any()))
                .thenReturn(List.of(started));
        when(repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(eq("resolved@example.com"),
                anyCollection(), eq(startedAt)))
                .thenReturn(true);

        watchdog.checkForMissingDispatch();

        verify(auditService, never()).record(anyString(),
                eq(RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING), anyString(), any());
    }

    @Test
    void doesNotReFlagARegistrationAlreadyFlaggedOnAPreviousRun() {
        RegistrationEventRepository repository = mock(RegistrationEventRepository.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        MutableClock clock = new MutableClock();
        RegistrationDispatchWatchdog watchdog = new RegistrationDispatchWatchdog(repository, auditService, clock);

        Instant startedAt = clock.instant().minus(RegistrationDispatchWatchdog.GRACE_PERIOD).minusSeconds(1);
        RegistrationEvent started = registerStartedAt("already-flagged@example.com", startedAt);

        when(repository.findByEventTypeAndCreatedAtBetween(eq(RegistrationEventType.REGISTER_STARTED), any(), any()))
                .thenReturn(List.of(started));
        // The resolution check itself doesn't distinguish which resolved type matched --
        // asserting the exact Set passed in confirms REGISTRATION_EMAIL_DISPATCH_MISSING is
        // included as a resolving type, which is what prevents re-flagging.
        when(repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(eq("already-flagged@example.com"),
                eq(Set.of(RegistrationEventType.VERIFICATION_EMAIL_SENT, RegistrationEventType.VERIFICATION_EMAIL_FAILED,
                        RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING)),
                eq(startedAt)))
                .thenReturn(true);

        watchdog.checkForMissingDispatch();

        verify(auditService, never()).record(anyString(),
                eq(RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING), anyString(), any());
        verify(repository, times(1)).existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(anyString(),
                anyCollection(), any());
    }
}
