package com.worktrac.backend.email;

import com.worktrac.backend.billing.BillingAuditService;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.PlusUpgradedEvent;
import com.worktrac.backend.user.User;
import com.worktrac.backend.user.UserRepository;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Pure unit tests (no Spring context), same shape as RegistrationEmailEventListenerTest: calls the
// @Async/@TransactionalEventListener method directly and synchronously -- those annotations only
// govern how Spring dispatches the call, not the method body under test here.
class PlusUpgradeEmailEventListenerTest {

    // Built and stubbed as its OWN statement, always BEFORE the when(...) that consumes it --
    // ownerNamed() does its own mock()/when()/thenReturn() cycle, and calling it directly inside
    // another when(...)'s argument list nests one stubbing inside another, which Mockito reports as
    // UnfinishedStubbing on the OUTER call. PersonGuardTest#person hit the same trap first.
    private User ownerNamed(String email) {
        User user = mock(User.class);
        when(user.getEmail()).thenReturn(email);
        return user;
    }

    @Test
    void aSuccessfulSendIsRecordedAsSentWithTheMessageId() {
        EmailService emailService = mock(EmailService.class);
        UserRepository userRepository = mock(UserRepository.class);
        BillingAuditService auditService = mock(BillingAuditService.class);
        PlusUpgradeEmailEventListener listener =
                new PlusUpgradeEmailEventListener(emailService, userRepository, auditService);

        User owner = ownerNamed("owner@example.com");
        when(userRepository.findOwners(42L)).thenReturn(List.of(owner));
        when(emailService.sendPlusWelcome("owner@example.com", BillingPlan.PLUS)).thenReturn("msg-1");

        listener.onPlusUpgraded(new PlusUpgradedEvent(42L, BillingPlan.PLUS));

        verify(auditService).record(42L, BillingEventType.PLUS_WELCOME_EMAIL_SENT, "msg-1");
        verify(auditService, never()).record(any(), eq(BillingEventType.PLUS_WELCOME_EMAIL_FAILED), any());
    }

    @Test
    void aSendFailureIsRecordedAsFailedWithTheReason() {
        EmailService emailService = mock(EmailService.class);
        UserRepository userRepository = mock(UserRepository.class);
        BillingAuditService auditService = mock(BillingAuditService.class);
        PlusUpgradeEmailEventListener listener =
                new PlusUpgradeEmailEventListener(emailService, userRepository, auditService);

        User owner = ownerNamed("owner@example.com");
        when(userRepository.findOwners(42L)).thenReturn(List.of(owner));
        doThrow(new RuntimeException("ACS send did not succeed: status=FAILED code=Throttled"))
                .when(emailService).sendPlusWelcome("owner@example.com", BillingPlan.PLUS);

        listener.onPlusUpgraded(new PlusUpgradedEvent(42L, BillingPlan.PLUS));

        verify(auditService).record(eq(42L), eq(BillingEventType.PLUS_WELCOME_EMAIL_FAILED), any());
        verify(auditService, never()).record(any(), eq(BillingEventType.PLUS_WELCOME_EMAIL_SENT), any());
    }

    // Not reachable in production -- applyStripeState only ever runs against an account that has an
    // owner -- but must degrade to a recorded, loud non-send rather than a silent no-op.
    @Test
    void noOwnerFoundIsRecordedRatherThanSilentlySkipped() {
        EmailService emailService = mock(EmailService.class);
        UserRepository userRepository = mock(UserRepository.class);
        BillingAuditService auditService = mock(BillingAuditService.class);
        PlusUpgradeEmailEventListener listener =
                new PlusUpgradeEmailEventListener(emailService, userRepository, auditService);

        when(userRepository.findOwners(99L)).thenReturn(List.of());

        listener.onPlusUpgraded(new PlusUpgradedEvent(99L, BillingPlan.PLUS));

        verify(emailService, never()).sendPlusWelcome(any(), any());
        verify(auditService).record(eq(99L), eq(BillingEventType.PLUS_WELCOME_EMAIL_FAILED), any());
    }

    // Mirrors RegistrationEmailEventListenerTest's conflation guard: a genuinely successful send
    // must never be misreported as failed because the AUDIT WRITE itself then throws.
    @Test
    void aFailureToPersistTheSentRowIsNotMisreportedAsAFailedSend() {
        EmailService emailService = mock(EmailService.class);
        UserRepository userRepository = mock(UserRepository.class);
        BillingAuditService auditService = mock(BillingAuditService.class);
        PlusUpgradeEmailEventListener listener =
                new PlusUpgradeEmailEventListener(emailService, userRepository, auditService);

        User owner = ownerNamed("owner@example.com");
        when(userRepository.findOwners(7L)).thenReturn(List.of(owner));
        when(emailService.sendPlusWelcome("owner@example.com", BillingPlan.PLUS)).thenReturn("msg-9");
        doThrow(new RuntimeException("DB hiccup"))
                .when(auditService).record(7L, BillingEventType.PLUS_WELCOME_EMAIL_SENT, "msg-9");

        // Must not throw out of the listener method itself.
        listener.onPlusUpgraded(new PlusUpgradedEvent(7L, BillingPlan.PLUS));

        verify(auditService, never()).record(eq(7L), eq(BillingEventType.PLUS_WELCOME_EMAIL_FAILED), any());
    }

    // ⚠️ THE TIER REACHES THE MAILBOX. The listener called sendPlusWelcome(email) with no plan at
    // all, so every paid tier got Plus's letter -- a trainer who had just paid for Pro was
    // congratulated on unlocking import. The plan rides on the event because by the time this
    // AFTER_COMMIT listener runs, the transaction that knew it has committed and gone.
    @Test
    void theTierThatWasBoughtIsWhatGetsMailed() {
        EmailService emailService = mock(EmailService.class);
        UserRepository userRepository = mock(UserRepository.class);
        BillingAuditService auditService = mock(BillingAuditService.class);
        PlusUpgradeEmailEventListener listener =
                new PlusUpgradeEmailEventListener(emailService, userRepository, auditService);

        User owner = ownerNamed("trainer@example.com");
        when(userRepository.findOwners(11L)).thenReturn(List.of(owner));
        when(emailService.sendPlusWelcome("trainer@example.com", BillingPlan.PRO)).thenReturn("msg-pro");

        listener.onPlusUpgraded(new PlusUpgradedEvent(11L, BillingPlan.PRO));

        verify(emailService).sendPlusWelcome("trainer@example.com", BillingPlan.PRO);
        verify(emailService, never()).sendPlusWelcome(any(), eq(BillingPlan.PLUS));
        verify(auditService).record(11L, BillingEventType.PLUS_WELCOME_EMAIL_SENT, "msg-pro");
    }
}
