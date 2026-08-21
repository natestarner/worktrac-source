package com.worktrac.backend.contact;

import com.worktrac.backend.config.AdminProperties;
import com.worktrac.backend.email.ContactEmailEventListener;
import com.worktrac.backend.email.EmailSendException;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationAlertSettings;
import com.worktrac.backend.registrationaudit.RegistrationAlertSettingsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Plain unit test -- no Spring context, no container. The listener's contract is entirely about
// which collaborator it calls with what, and driving it directly is what makes the SEND-vs-STATUS
// separation assertable at all: through the real async executor the two are indistinguishable.
class ContactAlertStatusTest {

    private EmailService emailService;
    private AdminProperties adminProperties;
    private RegistrationAlertSettingsService settingsService;
    private ContactAlertStatusService alertStatusService;
    private ContactEmailEventListener listener;
    private RegistrationAlertSettings settings;

    private static final ContactMessageReceivedEvent EVENT = new ContactMessageReceivedEvent(
            42L, ContactCategory.BUG, "Rest timer resets", "It resets mid-set.", "nate@example.com", "cid-123");

    @BeforeEach
    void setUp() {
        emailService = mock(EmailService.class);
        adminProperties = mock(AdminProperties.class);
        settingsService = mock(RegistrationAlertSettingsService.class);
        alertStatusService = mock(ContactAlertStatusService.class);
        settings = mock(RegistrationAlertSettings.class);

        when(adminProperties.normalizedEmails()).thenReturn(Set.of("admin@example.com"));
        when(settingsService.get()).thenReturn(settings);
        when(settings.isAlertOnContactMessage()).thenReturn(true);

        listener = new ContactEmailEventListener(emailService, adminProperties, settingsService, alertStatusService);
    }

    @Test
    void recordsSentWithTheMessageIdOnASuccessfulSend() {
        when(emailService.sendAdminAlert(anyCollection(), anyString(), anyString())).thenReturn("acs-message-id");

        listener.onContactMessageReceived(EVENT);

        verify(alertStatusService).recordSent(42L, "acs-message-id");
        verify(alertStatusService, never()).recordFailed(anyLong(), anyString());
    }

    // The detail must carry the REAL reason (the ACS status/code the exception already holds), not
    // just an exception class name -- it is what the admin portal shows beside a FAILED row.
    @Test
    void recordsFailedWithTheRealReasonWhenTheSendThrows() {
        doThrow(new EmailSendException("ACS send did not succeed: status=FAILED code=Throttled"))
                .when(emailService).sendAdminAlert(anyCollection(), anyString(), anyString());

        listener.onContactMessageReceived(EVENT);

        ArgumentCaptor<String> detail = ArgumentCaptor.forClass(String.class);
        verify(alertStatusService).recordFailed(eq(42L), detail.capture());
        assertTrue(detail.getValue().contains("Throttled"));
        verify(alertStatusService, never()).recordSent(anyLong(), anyString());
    }

    // The separation that registration-and-email.md requires: if the send SUCCEEDED but persisting
    // the status then failed, that must not be reported as a failed email -- the email genuinely
    // went out. It must also not escape this @Async void method.
    @Test
    void aFailureRecordingTheStatusIsNeverReportedAsASendFailure() {
        when(emailService.sendAdminAlert(anyCollection(), anyString(), anyString())).thenReturn("acs-message-id");
        doThrow(new RuntimeException("transient DB hiccup"))
                .when(alertStatusService).recordSent(anyLong(), anyString());

        listener.onContactMessageReceived(EVENT);

        verify(alertStatusService, never()).recordFailed(anyLong(), anyString());
    }

    @Test
    void doesNotSendWhenTheAdminHasTurnedContactAlertsOff() {
        when(settings.isAlertOnContactMessage()).thenReturn(false);

        listener.onContactMessageReceived(EVENT);

        verify(emailService, never()).sendAdminAlert(anyCollection(), anyString(), anyString());
        // Deliberately left at PENDING rather than inventing a fourth state: nobody was emailed,
        // which is exactly the configured outcome.
        verify(alertStatusService, never()).recordSent(anyLong(), any());
        verify(alertStatusService, never()).recordFailed(anyLong(), any());
    }

    // A subject line is an email HEADER. A bare CR/LF in user-supplied text is header injection.
    @Test
    void stripsNewlinesFromTheUserSuppliedSubject() {
        when(emailService.sendAdminAlert(anyCollection(), anyString(), anyString())).thenReturn("id");
        ContactMessageReceivedEvent injected = new ContactMessageReceivedEvent(
                7L, ContactCategory.OTHER,
                "Hello\r\nBcc: victim@example.com", "A long enough message body.", "nate@example.com", "cid");

        listener.onContactMessageReceived(injected);

        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        verify(emailService).sendAdminAlert(anyCollection(), subject.capture(), anyString());
        assertFalse(subject.getValue().contains("\r"));
        assertFalse(subject.getValue().contains("\n"));
        assertTrue(subject.getValue().contains("Bcc: victim@example.com"), "the text is kept, just defanged");
    }

    // The correlation id is the entire point of the triage workflow -- without it in the alert,
    // finding the person's request trail means going to the portal first.
    @Test
    void includesTheCorrelationIdInTheBody() {
        when(emailService.sendAdminAlert(anyCollection(), anyString(), anyString())).thenReturn("id");

        listener.onContactMessageReceived(EVENT);

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(emailService).sendAdminAlert(anyCollection(), anyString(), body.capture());
        assertTrue(body.getValue().contains("cid-123"));
        assertTrue(body.getValue().contains("nate@example.com"));
    }

    @Test
    void truncatesAnEnormousMessageAndSaysSo() {
        when(emailService.sendAdminAlert(anyCollection(), anyString(), anyString())).thenReturn("id");
        ContactMessageReceivedEvent huge = new ContactMessageReceivedEvent(
                9L, ContactCategory.OTHER, "Long one", "x".repeat(4000), "nate@example.com", "cid");

        listener.onContactMessageReceived(huge);

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(emailService).sendAdminAlert(anyCollection(), anyString(), body.capture());
        assertTrue(body.getValue().contains("truncated"));
        // Counting 'x' characters would also catch the one in "example.com" from the From: line --
        // assert on the run of them instead.
        assertTrue(body.getValue().contains("x".repeat(2000)));
        assertFalse(body.getValue().contains("x".repeat(2001)));
    }
}
