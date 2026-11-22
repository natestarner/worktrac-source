package com.worktrac.backend.email;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
import com.azure.communication.email.models.EmailSendStatus;
import com.azure.core.util.polling.LongRunningOperationStatus;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
import com.worktrac.backend.user.SecurityNoticeEvent;
import com.worktrac.backend.user.SecurityNoticeEvent.Kind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * What each security notice SAYS. The words are the control: the reader may be the person locked
 * out, so each one must name the change, the time, and a remedy that actually works for that change
 * -- which is not always the same remedy.
 */
class EmailServiceSecurityNoticeTest {

    private static final String RECIPIENT = "person@example.com";
    // 2026-11-21 15:04 UTC
    private static final Instant AT = Instant.parse("2026-11-21T15:04:00Z");

    private EmailClient emailClient;
    private EmailService emailService;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        emailClient = mock(EmailClient.class);
        SyncPoller<EmailSendResult, EmailSendResult> poller = mock(SyncPoller.class);
        when(emailClient.beginSend(any(EmailMessage.class))).thenReturn(poller);
        when(poller.waitUntil(EmailService.SEND_TIMEOUT, LongRunningOperationStatus.SUCCESSFULLY_COMPLETED))
                .thenReturn(new PollResponse<>(LongRunningOperationStatus.SUCCESSFULLY_COMPLETED,
                        new EmailSendResult("msg-1", EmailSendStatus.SUCCEEDED, null)));

        EmailProperties properties = new EmailProperties();
        properties.setConnectionString(
                "endpoint=https://fake-resource.communication.azure.com/;accesskey=ZmFrZWFjY2Vzc2tleWZvcnRlc3Rpbmc=");
        properties.setSenderAddress("DoNotReply@example.com");
        properties.setAppUrl("https://app.example.com/app/log");
        properties.setCodeExpirationMinutes(15);
        emailService = new EmailService(properties, emailClient, mock(RegistrationAuditService.class));
    }

    private EmailMessage sent(SecurityNoticeEvent event) {
        emailService.sendSecurityNotice(event);
        ArgumentCaptor<EmailMessage> message = ArgumentCaptor.forClass(EmailMessage.class);
        verify(emailClient).beginSend(message.capture());
        return message.getValue();
    }

    private static SecurityNoticeEvent notice(Kind kind, String provider) {
        return SecurityNoticeEvent.of(RECIPIENT, kind, provider, AT);
    }

    @Test
    void goesToTheLoginWithTheTimeInUtcAndAPlainTextPart() {
        EmailMessage message = sent(notice(Kind.PASSWORD_CHANGED, null));

        assertThat(message.getToRecipients()).singleElement()
                .satisfies(r -> assertThat(r.getAddress()).isEqualTo(RECIPIENT));
        assertThat(message.getSubject()).isEqualTo("Your Huddle password was changed");
        // The server does not know the reader's zone, so it says UTC rather than guessing.
        assertThat(message.getBodyHtml()).contains("November 21, 2026 at 3:04 PM UTC");
        // The text part carries no markup.
        assertThat(message.getBodyPlainText()).doesNotContain("<b>").doesNotContain("<br>")
                .contains("Forgot password?").contains("https://app.example.com/app/log");
    }

    @Test
    void aPasswordChangeOrAdditionPointsAtAReset() {
        for (Kind kind : new Kind[] {Kind.PASSWORD_CHANGED, Kind.PASSWORD_ADDED}) {
            setUp();
            EmailMessage message = sent(notice(kind, null));
            assertThat(message.getBodyHtml())
                    .contains("If this wasn't you, reset your password right away")
                    .contains("signs out every device");
        }
    }

    // ⚠️ A reset would NOT remove somebody else's connected account: they could sign in with it again
    // straight away. The remedy for a connection is to disconnect it, which also signs every other
    // device out, and only then to change the password.
    @Test
    void aConnectionSaysToDisconnectItNotMerelyToResetThePassword() {
        EmailMessage message = sent(notice(Kind.SIGN_IN_CONNECTED, "Google"));

        assertThat(message.getSubject()).isEqualTo("Google was connected to your Huddle login");
        assertThat(message.getBodyHtml())
                .contains("disconnect Google")
                .contains("Profile &rarr; Sign in with")
                .doesNotContain("If this wasn't you, reset your password right away");
    }

    @Test
    void aDisconnectionSaysWhatChangedAndPointsAtAReset() {
        EmailMessage message = sent(notice(Kind.SIGN_IN_DISCONNECTED, "Apple"));

        assertThat(message.getSubject()).isEqualTo("Apple was disconnected from your Huddle login");
        assertThat(message.getBodyHtml())
                .contains("Apple no longer signs you in to Huddle")
                .contains("If this wasn't you, reset your password right away");
    }

    // When Apple was the only way in, the email is the only place that says how to get back.
    @Test
    void appleTurnedOffSaysHowToGetBackOnlyWhenThereIsNoOtherWayIn() {
        EmailMessage stranded = sent(new SecurityNoticeEvent(
                RECIPIENT, Kind.SIGN_IN_TURNED_OFF_AT_APPLE, "Apple", AT.toEpochMilli(), false));
        assertThat(stranded.getSubject()).isEqualTo("Sign in with Apple was turned off for Huddle");
        assertThat(stranded.getBodyHtml())
                .contains("To sign in again, use <b>Forgot password?</b>")
                .contains("your workouts are unaffected");

        setUp();
        EmailMessage stillIn = sent(new SecurityNoticeEvent(
                RECIPIENT, Kind.SIGN_IN_TURNED_OFF_AT_APPLE, "Apple", AT.toEpochMilli(), true));
        assertThat(stillIn.getBodyHtml())
                .contains("You can still sign in to Huddle another way.")
                .doesNotContain("To sign in again");
    }

    // A security email that carries a sign-in or account link is the shape phishing copies. The only
    // link is the ordinary "open the app" one.
    @Test
    void carriesNoLinkButTheAppItself() {
        for (Kind kind : Kind.values()) {
            setUp();
            EmailMessage message = sent(notice(kind, "Google"));
            String html = message.getBodyHtml();
            // Every href in the email: the app link, plus whatever the template itself carries.
            assertThat(html).contains("href=\"https://app.example.com/app/log\"");
            assertThat(html).doesNotContain("/join?").doesNotContain("reset-password").doesNotContain("token=");
        }
    }
}
