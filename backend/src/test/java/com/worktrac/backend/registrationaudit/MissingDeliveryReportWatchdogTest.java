package com.worktrac.backend.registrationaudit;

import com.worktrac.backend.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// The net under EmailService no longer resending an ACCEPTED-but-unconfirmed email: such a send's
// outcome rests on its Event Grid delivery report, so one that never arrives must raise an alert
// rather than leave the email looking fine. Pure unit test, same shape as
// RegistrationDispatchWatchdogTest.
class MissingDeliveryReportWatchdogTest {

    private RegistrationEventRepository repository;
    private RegistrationAuditService auditService;
    private MutableClock clock;
    private RegistrationDispatchWatchdog watchdog;

    @BeforeEach
    void setUp() {
        repository = mock(RegistrationEventRepository.class);
        auditService = mock(RegistrationAuditService.class);
        clock = new MutableClock();
        watchdog = new RegistrationDispatchWatchdog(repository, auditService, clock);
    }

    private Instant pastTheGrace() {
        return clock.instant().minus(RegistrationDispatchWatchdog.DELIVERY_REPORT_GRACE).minusSeconds(1);
    }

    private void unconfirmedSends(RegistrationEvent... events) {
        when(repository.findByEventTypeAndCreatedAtBetween(
                eq(RegistrationEventType.EMAIL_SEND_UNCONFIRMED), any(), any())).thenReturn(List.of(events));
    }

    private RegistrationEvent unconfirmed(String email, String messageId, Instant at) {
        return new RegistrationEvent(email, RegistrationEventType.EMAIL_SEND_UNCONFIRMED, null, null, messageId, at);
    }

    @Test
    void anUnconfirmedSendWithNoDeliveryReportAfterTheGraceIsFlagged() {
        unconfirmedSends(unconfirmed("lost@example.com", "msg-1", pastTheGrace()));
        when(repository.existsByMessageIdAndEventTypeIn(eq("msg-1"), anyCollection())).thenReturn(false);

        // Through the scheduled entry point, so this also proves the check is wired into the tick.
        watchdog.checkForMissingDispatch();

        verify(auditService).record(eq("lost@example.com"),
                eq(RegistrationEventType.EMAIL_DELIVERY_REPORT_MISSING), anyString(), isNull(), eq("msg-1"));
    }

    @Test
    void anUnconfirmedSendWhoseDeliveryReportArrivedIsLeftAlone() {
        unconfirmedSends(unconfirmed("late@example.com", "msg-2", pastTheGrace()));
        when(repository.existsByMessageIdAndEventTypeIn(eq("msg-2"), anyCollection())).thenReturn(true);

        watchdog.checkForMissingDeliveryReports(clock.instant());

        verify(auditService, never()).record(anyString(),
                eq(RegistrationEventType.EMAIL_DELIVERY_REPORT_MISSING), any(), any(), any());
    }

    @Test
    void everyEventGridOutcomeCountsAsADeliveryReport() {
        unconfirmedSends(unconfirmed("late@example.com", "msg-3", pastTheGrace()));

        watchdog.checkForMissingDeliveryReports(clock.instant());

        verify(repository).existsByMessageIdAndEventTypeIn("msg-3", Set.of(
                RegistrationEventType.EMAIL_DELIVERED,
                RegistrationEventType.EMAIL_BOUNCED,
                RegistrationEventType.EMAIL_DELIVERY_FAILED,
                RegistrationEventType.EMAIL_FILTERED_SPAM,
                RegistrationEventType.EMAIL_SUPPRESSED,
                RegistrationEventType.EMAIL_QUARANTINED));
    }

    @Test
    void anUnconfirmedSendAlreadyFlaggedIsNotFlaggedAgain() {
        Instant at = pastTheGrace();
        unconfirmedSends(unconfirmed("lost@example.com", "msg-4", at));
        when(repository.existsByMessageIdAndEventTypeIn(eq("msg-4"), anyCollection())).thenReturn(false);
        when(repository.existsByEmailAndEventTypeInAndCreatedAtGreaterThanEqual("lost@example.com",
                Set.of(RegistrationEventType.EMAIL_DELIVERY_REPORT_MISSING), at)).thenReturn(true);

        watchdog.checkForMissingDeliveryReports(clock.instant());

        verify(auditService, never()).record(anyString(),
                eq(RegistrationEventType.EMAIL_DELIVERY_REPORT_MISSING), any(), any(), any());
    }

    @Test
    void anUnconfirmedSendWithNoMessageIdCanNeverBeMatchedSoIsFlagged() {
        // Its status polls failed, so no id survived to match a report against.
        unconfirmedSends(unconfirmed("unknown@example.com", null, pastTheGrace()));

        watchdog.checkForMissingDeliveryReports(clock.instant());

        verify(auditService).record(eq("unknown@example.com"),
                eq(RegistrationEventType.EMAIL_DELIVERY_REPORT_MISSING), anyString(), isNull(), isNull());
    }

    @Test
    void onlyUnconfirmedSendsOlderThanTheGraceAreConsidered() {
        Instant now = clock.instant();

        watchdog.checkForMissingDeliveryReports(now);

        Instant windowEnd = now.minus(RegistrationDispatchWatchdog.DELIVERY_REPORT_GRACE);
        verify(repository).findByEventTypeAndCreatedAtBetween(RegistrationEventType.EMAIL_SEND_UNCONFIRMED,
                windowEnd.minus(RegistrationDispatchWatchdog.DELIVERY_REPORT_LOOKBACK), windowEnd);
    }
}
