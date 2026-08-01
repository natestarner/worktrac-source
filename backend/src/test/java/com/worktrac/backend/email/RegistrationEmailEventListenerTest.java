package com.worktrac.backend.email;

import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.user.RegistrationConfirmedEvent;
import com.worktrac.backend.user.VerificationCodeIssuedEvent;
import org.junit.jupiter.api.Test;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Pure unit tests (no Spring context) for the conflation bug fixed alongside the
// AsyncConfig.CallerRunsPolicy change: a failure while persisting the *audit row itself* must
// never be misreported as the email having failed to send, since the send may have genuinely
// succeeded. Calls the @Async/@TransactionalEventListener methods directly and synchronously --
// those annotations only matter for how Spring dispatches the call, not the method body's own
// logic, which is exactly what's under test here.
class RegistrationEmailEventListenerTest {

    @Test
    void aSendFailureIsRecordedAsFailedWithTheReason() {
        EmailService emailService = mock(EmailService.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        RegistrationEmailEventListener listener = new RegistrationEmailEventListener(emailService, auditService);

        doThrow(new RuntimeException("ACS send did not succeed: status=FAILED code=Throttled"))
                .when(emailService).sendVerificationCode("a@example.com", "123456");

        listener.onVerificationCodeIssued(new VerificationCodeIssuedEvent("a@example.com", "123456"));

        verify(auditService).record(eq("a@example.com"), eq(RegistrationEventType.VERIFICATION_EMAIL_FAILED),
                any(), isNull(), isNull());
        verify(auditService, never()).record(eq("a@example.com"), eq(RegistrationEventType.VERIFICATION_EMAIL_SENT),
                any(), any(), any());
    }

    @Test
    void aSuccessfulSendIsRecordedAsSentWithTheMessageId() {
        EmailService emailService = mock(EmailService.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        RegistrationEmailEventListener listener = new RegistrationEmailEventListener(emailService, auditService);

        when(emailService.sendVerificationCode("b@example.com", "654321")).thenReturn("msg-42");

        listener.onVerificationCodeIssued(new VerificationCodeIssuedEvent("b@example.com", "654321"));

        verify(auditService).record("b@example.com", RegistrationEventType.VERIFICATION_EMAIL_SENT, null, null,
                "msg-42");
        verify(auditService, never()).record(eq("b@example.com"),
                eq(RegistrationEventType.VERIFICATION_EMAIL_FAILED), any(), any(), any());
    }

    // The bug this guards against: the send genuinely succeeds, but the SUCCESS audit-write
    // itself throws (e.g. a transient DB hiccup at that exact moment). Before the fix, this
    // exception was caught by the same catch block that handles a real send failure, silently
    // misreporting a successfully-delivered email as VERIFICATION_EMAIL_FAILED -- which, worse,
    // would also have falsely triggered an admin "send failure" alert for an email that actually
    // went out fine. The correct behavior is that neither a SENT nor a FAILED row must be forced
    // through incorrectly; the failure to record is only logged.
    @Test
    void aFailureToPersistTheSentAuditRowIsNotMisreportedAsAFailedSend() {
        EmailService emailService = mock(EmailService.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        RegistrationEmailEventListener listener = new RegistrationEmailEventListener(emailService, auditService);

        when(emailService.sendVerificationCode("c@example.com", "111111")).thenReturn("msg-99");
        doThrow(new RuntimeException("DB hiccup"))
                .when(auditService).record("c@example.com", RegistrationEventType.VERIFICATION_EMAIL_SENT, null,
                        null, "msg-99");

        // Must not throw out of the listener method itself.
        listener.onVerificationCodeIssued(new VerificationCodeIssuedEvent("c@example.com", "111111"));

        verify(auditService, never()).record(eq("c@example.com"),
                eq(RegistrationEventType.VERIFICATION_EMAIL_FAILED), any(), any(), any());
    }

    @Test
    void registrationSuccessEmailFailureIsRecordedSeparatelyFromVerificationEmail() {
        EmailService emailService = mock(EmailService.class);
        RegistrationAuditService auditService = mock(RegistrationAuditService.class);
        RegistrationEmailEventListener listener = new RegistrationEmailEventListener(emailService, auditService);

        doThrow(new RuntimeException("ACS unavailable")).when(emailService).sendRegistrationSuccess("d@example.com");

        listener.onRegistrationConfirmed(new RegistrationConfirmedEvent("d@example.com"));

        verify(auditService).record(eq("d@example.com"), eq(RegistrationEventType.SUCCESS_EMAIL_FAILED), any(),
                isNull(), isNull());
    }
}
