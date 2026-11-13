package com.worktrac.backend.email;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
import com.azure.communication.email.models.EmailSendStatus;
import com.azure.core.models.ResponseError;
import com.azure.core.util.polling.LongRunningOperationStatus;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// What send() does with each thing ACS can say after accepting an email. The outbox retries a send
// exactly when send() THROWS, so "does it throw?" is "will this email be sent again?".
//
// The case this exists for: on 2026-11-12 ACS accepted every email but stopped confirming within
// the 2-minute wait, the old waitForCompletion threw, and every email went out up to five times,
// each also reported to the admin as FAILED.
// docs/incidents/2026-11-12-acs-slow-confirmation-resent-accepted-email.md
class EmailServiceSendOutcomeTest {

    private static final String RECIPIENT = "person@example.com";

    private EmailClient emailClient;
    @SuppressWarnings("unchecked")
    private final SyncPoller<EmailSendResult, EmailSendResult> poller = mock(SyncPoller.class);
    private RegistrationAuditService auditService;
    private EmailService emailService;

    @BeforeEach
    void setUp() {
        emailClient = mock(EmailClient.class);
        auditService = mock(RegistrationAuditService.class);
        when(emailClient.beginSend(any(EmailMessage.class))).thenReturn(poller);

        EmailProperties properties = new EmailProperties();
        properties.setConnectionString(
                "endpoint=https://fake-resource.communication.azure.com/;accesskey=ZmFrZWFjY2Vzc2tleWZvcnRlc3Rpbmc=");
        properties.setSenderAddress("DoNotReply@example.com");
        properties.setAppUrl("https://app.example.com/app/log");
        properties.setCodeExpirationMinutes(15);
        emailService = new EmailService(properties, emailClient, auditService);
    }

    private void acsAnswers(LongRunningOperationStatus status, EmailSendResult result) {
        when(poller.waitUntil(EmailService.SEND_TIMEOUT, LongRunningOperationStatus.SUCCESSFULLY_COMPLETED))
                .thenReturn(new PollResponse<>(status, result));
    }

    @Test
    void aConfirmedSendReturnsItsMessageIdAndRecordsNothingExtra() {
        acsAnswers(LongRunningOperationStatus.SUCCESSFULLY_COMPLETED,
                new EmailSendResult("msg-1", EmailSendStatus.SUCCEEDED, null));

        assertEquals("msg-1", emailService.sendRegistrationSuccess(RECIPIENT));
        verify(auditService, never()).record(anyString(), any(), any(), any(), any());
    }

    @Test
    void aSendAcsFailsWithinTheWaitStillThrowsSoItIsRetriedAndReportedFailed() {
        // The 2026-08-01 guarantee: a non-exception ACS failure must never vanish.
        acsAnswers(LongRunningOperationStatus.FAILED, new EmailSendResult("msg-2", EmailSendStatus.FAILED,
                new ResponseError("EmailDroppedAllRecipientsSuppressed", "all recipients suppressed")));

        EmailSendException thrown = assertThrows(EmailSendException.class,
                () -> emailService.sendRegistrationSuccess(RECIPIENT));
        assertTrue(thrown.getMessage().contains("EmailDroppedAllRecipientsSuppressed"), thrown.getMessage());
    }

    @Test
    void anAcceptedSendStillRunningWhenTheWaitEndsIsNotRetriedAndIsRecordedAsUnconfirmed() {
        acsAnswers(LongRunningOperationStatus.IN_PROGRESS,
                new EmailSendResult("msg-3", EmailSendStatus.RUNNING, null));

        // Returning (not throwing) is what stops the outbox sending it again.
        assertEquals("msg-3", emailService.sendRegistrationSuccess(RECIPIENT));
        verify(auditService).record(eq(RECIPIENT), eq(RegistrationEventType.EMAIL_SEND_UNCONFIRMED),
                anyString(), isNull(), eq("msg-3"));
    }

    @Test
    void anAdminAlertToSeveralAddressesRecordsEachRecipient() {
        acsAnswers(LongRunningOperationStatus.IN_PROGRESS,
                new EmailSendResult("msg-4", EmailSendStatus.RUNNING, null));

        emailService.sendAdminAlert(java.util.List.of("a@example.com", "b@example.com"), "subject", "body");

        verify(auditService).record(eq("a@example.com"), eq(RegistrationEventType.EMAIL_SEND_UNCONFIRMED),
                anyString(), isNull(), eq("msg-4"));
        verify(auditService).record(eq("b@example.com"), eq(RegistrationEventType.EMAIL_SEND_UNCONFIRMED),
                anyString(), isNull(), eq("msg-4"));
    }

    @Test
    void anAcceptedSendWhoseStatusCannotBeCheckedIsNotRetriedEither() {
        when(poller.waitUntil(EmailService.SEND_TIMEOUT, LongRunningOperationStatus.SUCCESSFULLY_COMPLETED))
                .thenThrow(new RuntimeException("429 Too Many Requests on GetMessageStatus"));

        assertNull(emailService.sendRegistrationSuccess(RECIPIENT));
        verify(auditService).record(eq(RECIPIENT), eq(RegistrationEventType.EMAIL_SEND_UNCONFIRMED),
                anyString(), isNull(), isNull());
    }

    @Test
    void aSendAcsNeverAcceptedThrowsSoItIsRetried() {
        // Nothing was accepted, so a retry cannot duplicate anything.
        when(emailClient.beginSend(any(EmailMessage.class))).thenThrow(new RuntimeException("connection reset"));

        assertThrows(RuntimeException.class, () -> emailService.sendRegistrationSuccess(RECIPIENT));
        verify(auditService, never()).record(anyString(), any(), any(), any(), any());
    }

    @Test
    void failingToRecordTheUnconfirmedRowNeverTurnsAnAcceptedSendIntoARetry() {
        acsAnswers(LongRunningOperationStatus.IN_PROGRESS,
                new EmailSendResult("msg-5", EmailSendStatus.RUNNING, null));
        doThrow(new RuntimeException("db down")).when(auditService)
                .record(anyString(), any(), any(), any(), any());

        assertEquals("msg-5", emailService.sendRegistrationSuccess(RECIPIENT));
    }
}
