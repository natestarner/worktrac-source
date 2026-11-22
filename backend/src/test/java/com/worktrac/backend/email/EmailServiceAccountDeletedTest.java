package com.worktrac.backend.email;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
import com.azure.communication.email.models.EmailSendStatus;
import com.azure.core.util.polling.LongRunningOperationStatus;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import com.worktrac.backend.account.AccountDeletedEvent;
import com.worktrac.backend.account.AccountDeletedEvent.Billing;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.registrationaudit.RegistrationAuditService;
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
 * What the account-deleted email SAYS, to the login that deleted the household and to everybody
 * else who had a way in. The words are the point: a deletion nobody meant is a stolen credential,
 * and this is how its holder finds out.
 */
class EmailServiceAccountDeletedTest {

    private static final String RECIPIENT = "person@example.com";
    private static final long AT = Instant.parse("2026-11-21T15:04:00Z").toEpochMilli();
    private static final String APP_URL = "https://app.example.com/app/log";

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
        properties.setAppUrl(APP_URL);
        properties.setCodeExpirationMinutes(15);
        emailService = new EmailService(properties, emailClient, mock(RegistrationAuditService.class));
    }

    private EmailMessage sent(AccountDeletedEvent event) {
        emailService.sendAccountDeleted(event);
        ArgumentCaptor<EmailMessage> message = ArgumentCaptor.forClass(EmailMessage.class);
        verify(emailClient).beginSend(message.capture());
        return message.getValue();
    }

    private static AccountDeletedEvent deleted(String name, boolean youDeletedIt, boolean loginRemains,
                                               Billing billing) {
        return new AccountDeletedEvent(RECIPIENT, name, AT, youDeletedIt, loginRemains, billing);
    }

    @Test
    void theOneWhoDeletedItIsToldWhatWentWhenAndThatItCannotBeUndone() {
        EmailMessage message = sent(deleted("Starner Household", true, false, Billing.NONE));

        assertThat(message.getToRecipients()).singleElement()
                .satisfies(r -> assertThat(r.getAddress()).isEqualTo(RECIPIENT));
        assertThat(message.getSubject()).isEqualTo("Your Huddle account was deleted");
        assertThat(message.getBodyHtml())
                .contains("Starner Household was permanently deleted on November 21, 2026 at 3:04 PM UTC")
                .contains("This can't be undone.")
                .contains("Your login was deleted with it.")
                // The remedy for a deletion they didn't make is a person: the account is gone.
                .contains("If you didn't do this")
                .contains("mailto:support@huddle.fitness");
        assertThat(message.getBodyPlainText()).doesNotContain("<").contains("support@huddle.fitness");
    }

    // A login that no longer exists has nothing to open: the button would lead to a sign-in that
    // can only fail. A login kept for another household still gets it.
    @Test
    void aDeletedLoginGetsNoOpenHuddleButtonAndAKeptOneDoes() {
        EmailMessage gone = sent(deleted("Starner Household", true, false, Billing.NONE));
        assertThat(gone.getBodyHtml()).doesNotContain("Open Huddle").doesNotContain(APP_URL);
        assertThat(gone.getBodyPlainText()).doesNotContain(APP_URL);

        setUp();
        EmailMessage kept = sent(deleted("Starner Household", true, true, Billing.NONE));
        assertThat(kept.getBodyHtml()).contains("Open Huddle").contains(APP_URL)
                .contains("Your login still signs you in to your other households");
    }

    @Test
    void aWebPlanIsSaidToBeCancelled() {
        assertThat(sent(deleted("H", true, false, Billing.WEB_CANCELLED)).getBodyHtml())
                .contains("Your paid plan was cancelled with it");
    }

    // Apple bills it, so only the subscriber can stop it. The email is the last place to say so.
    @Test
    void anAppStoreSubscriptionIsSaidToStillBeBillingWithHowToCancelIt() {
        EmailMessage message = sent(deleted("H", true, false, Billing.STORE_STILL_BILLING));
        assertThat(message.getBodyHtml())
                .contains("Your App Store subscription is still active")
                .contains("Subscriptions");
        assertThat(message.getBodyPlainText()).contains("Settings → your name → Subscriptions");
    }

    @Test
    void anotherMemberIsToldTheOwnerDeletedItAndWhetherTheirLoginRemains() {
        EmailMessage message = sent(deleted("Starner Household", false, true, Billing.NONE));
        assertThat(message.getSubject()).isEqualTo("Starner Household was deleted from Huddle");
        assertThat(message.getBodyHtml())
                .contains("was permanently deleted by its owner on November 21, 2026 at 3:04 PM UTC")
                .contains("including yours there")
                .contains("Your login still signs you in to your other households")
                .doesNotContain("paid plan");
    }

    // The household's name is free text it typed: escaped in the HTML, plain in the subject.
    @Test
    void theHouseholdNameIsEscaped() {
        EmailMessage message = sent(deleted("<script>x</script> & Co", false, false, Billing.NONE));
        assertThat(message.getBodyHtml()).doesNotContain("<script>").contains("&lt;script&gt;");
        assertThat(message.getSubject()).isEqualTo("<script>x</script> & Co was deleted from Huddle");
    }
}
