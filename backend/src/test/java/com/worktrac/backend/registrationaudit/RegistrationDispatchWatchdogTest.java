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

    // ── Member invites ────────────────────────────────────────────────────────────────────────
    //
    // The same three cases again, for the second flow in WATCHED. They are not redundant with the
    // registration ones: the whole point of generalizing this class rather than adding a sibling
    // was that a NEW flow gets the safety net by being a row in the table, and nothing proves that
    // except exercising a second row.

    private RegistrationEvent inviteStartedAt(String email, Instant createdAt) {
        return new RegistrationEvent(email, RegistrationEventType.MEMBER_INVITE_STARTED,
                null, null, null, createdAt);
    }

    @Test
    void flagsAMemberInviteWithNoEmailOutcomeAfterTheGracePeriod() {
        RegistrationEventRepository repository = mock(RegistrationEventRepository.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        MutableClock clock = new MutableClock();
        RegistrationDispatchWatchdog watchdog = new RegistrationDispatchWatchdog(repository, auditService, clock);

        Instant startedAt = clock.instant().minus(RegistrationDispatchWatchdog.GRACE_PERIOD).minusSeconds(1);

        when(repository.findByEventTypeAndCreatedAtBetween(
                eq(RegistrationEventType.MEMBER_INVITE_STARTED), any(), any()))
                .thenReturn(List.of(inviteStartedAt("invited@example.com", startedAt)));
        when(repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(eq("invited@example.com"),
                anyCollection(), eq(startedAt)))
                .thenReturn(false);

        watchdog.checkForMissingDispatch();

        verify(auditService).record(eq("invited@example.com"),
                eq(RegistrationEventType.MEMBER_INVITE_DISPATCH_MISSING), anyString(), any());
    }

    @Test
    void doesNotFlagAMemberInviteThatAlreadyHasAnEmailOutcome() {
        RegistrationEventRepository repository = mock(RegistrationEventRepository.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        MutableClock clock = new MutableClock();
        RegistrationDispatchWatchdog watchdog = new RegistrationDispatchWatchdog(repository, auditService, clock);

        Instant startedAt = clock.instant().minus(RegistrationDispatchWatchdog.GRACE_PERIOD).minusSeconds(1);

        when(repository.findByEventTypeAndCreatedAtBetween(
                eq(RegistrationEventType.MEMBER_INVITE_STARTED), any(), any()))
                .thenReturn(List.of(inviteStartedAt("sent@example.com", startedAt)));
        // Asserting the exact Set confirms MEMBER_INVITE_DISPATCH_MISSING is among this row's own
        // resolving types -- which is what stops an already-flagged invite being re-flagged, and
        // re-alerted, on every tick from now on.
        when(repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(eq("sent@example.com"),
                eq(Set.of(RegistrationEventType.MEMBER_INVITE_EMAIL_SENT,
                        RegistrationEventType.MEMBER_INVITE_EMAIL_FAILED,
                        RegistrationEventType.MEMBER_INVITE_DISPATCH_MISSING)),
                eq(startedAt)))
                .thenReturn(true);

        watchdog.checkForMissingDispatch();

        verify(auditService, never()).record(anyString(),
                eq(RegistrationEventType.MEMBER_INVITE_DISPATCH_MISSING), anyString(), any());
    }

    /**
     * ⚠️ One pass covers BOTH flows.
     *
     * <p>This is the test that would fail if somebody "simplified" WATCHED back to a single row, or
     * added a second watchdog class and left this one registration-only. Either mistake leaves a
     * stuck invite invisible while every registration assertion above stays green.
     */
    @Test
    void oneRunReconcilesEveryWatchedFlow() {
        RegistrationEventRepository repository = mock(RegistrationEventRepository.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        MutableClock clock = new MutableClock();
        RegistrationDispatchWatchdog watchdog = new RegistrationDispatchWatchdog(repository, auditService, clock);

        Instant startedAt = clock.instant().minus(RegistrationDispatchWatchdog.GRACE_PERIOD).minusSeconds(1);

        when(repository.findByEventTypeAndCreatedAtBetween(
                eq(RegistrationEventType.REGISTER_STARTED), any(), any()))
                .thenReturn(List.of(registerStartedAt("stuck-register@example.com", startedAt)));
        when(repository.findByEventTypeAndCreatedAtBetween(
                eq(RegistrationEventType.MEMBER_INVITE_STARTED), any(), any()))
                .thenReturn(List.of(inviteStartedAt("stuck-invite@example.com", startedAt)));
        when(repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual(anyString(),
                anyCollection(), any()))
                .thenReturn(false);

        watchdog.checkForMissingDispatch();

        verify(auditService).record(eq("stuck-register@example.com"),
                eq(RegistrationEventType.REGISTRATION_EMAIL_DISPATCH_MISSING), anyString(), any());
        verify(auditService).record(eq("stuck-invite@example.com"),
                eq(RegistrationEventType.MEMBER_INVITE_DISPATCH_MISSING), anyString(), any());
    }
}
