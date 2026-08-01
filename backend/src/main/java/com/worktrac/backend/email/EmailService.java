package com.worktrac.backend.email;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.EmailClientBuilder;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
import com.azure.communication.email.models.EmailSendStatus;
import com.azure.core.models.ResponseError;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import com.worktrac.backend.config.EmailProperties;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Collection;

@Service
public class EmailService {

    private final EmailClient emailClient;
    private final String senderAddress;
    private final String appUrl;
    private final String logoUrl;
    private final int codeExpirationMinutes;
    private final String verificationCodeTemplate;
    private final String registrationSuccessTemplate;
    private final String passwordResetCodeTemplate;
    private final String passwordResetSuccessTemplate;

    public EmailService(EmailProperties properties) {
        this.emailClient = new EmailClientBuilder()
                .connectionString(properties.getConnectionString())
                .buildClient();
        this.senderAddress = properties.getSenderAddress();
        this.appUrl = properties.getAppUrl();
        this.logoUrl = logoUrlFrom(appUrl);
        this.codeExpirationMinutes = properties.getCodeExpirationMinutes();
        this.verificationCodeTemplate = loadTemplate("templates/email/verification-code.html");
        this.registrationSuccessTemplate = loadTemplate("templates/email/registration-success.html");
        this.passwordResetCodeTemplate = loadTemplate("templates/email/password-reset-code.html");
        this.passwordResetSuccessTemplate = loadTemplate("templates/email/password-reset-success.html");
    }

    // Returns the ACS messageId -- the correlation key RegistrationEmailEventListener records
    // alongside VERIFICATION_EMAIL_SENT so a later Event Grid delivery report (which only
    // carries a messageId, not this email's context) can be matched back to this send.
    public String sendVerificationCode(String toEmail, String code) {
        String html = verificationCodeTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{CODE_PART_1}}", code.substring(0, 3))
                .replace("{{CODE_PART_2}}", code.substring(3))
                .replace("{{EXPIRATION_MINUTES}}", String.valueOf(codeExpirationMinutes));

        return send(toEmail, "Your Huddle verification code", plainTextVerificationCode(code), html);
    }

    public String sendRegistrationSuccess(String toEmail) {
        String html = registrationSuccessTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{APP_URL}}", appUrl);

        return send(toEmail, "You're all set! Your Huddle account is confirmed",
                "Your Huddle account is confirmed and ready to go. Open the app: " + appUrl, html);
    }

    public String sendPasswordResetCode(String toEmail, String code) {
        String html = passwordResetCodeTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{CODE_PART_1}}", code.substring(0, 3))
                .replace("{{CODE_PART_2}}", code.substring(3))
                .replace("{{EXPIRATION_MINUTES}}", String.valueOf(codeExpirationMinutes));

        return send(toEmail, "Your Huddle password reset code", plainTextPasswordResetCode(code), html);
    }

    public String sendPasswordResetSuccess(String toEmail) {
        String html = passwordResetSuccessTemplate.replace("{{LOGO_URL}}", logoUrl);

        return send(toEmail, "Your Huddle password was changed",
                "The password on your Huddle account was just reset. If this wasn't you, reset it again right away.",
                html);
    }

    // Plain-text only (no template) -- this goes to the app's own admins, not end users, in
    // response to a registration event they've opted into via the alert-settings toggle.
    public void sendAdminAlert(Collection<String> toEmails, String subject, String body) {
        if (toEmails.isEmpty()) return;
        send(toEmails.toArray(new String[0]), subject, body, null);
    }

    // Email clients need a real, absolute image URL (inline <svg> and data: URIs are both
    // unreliable across Gmail/Outlook) -- rather than a separate config property to keep in
    // sync with app-url per environment, the logo always lives at a fixed path on the same
    // origin the app itself is served from.
    private String logoUrlFrom(String appUrl) {
        try {
            URI uri = new URI(appUrl);
            return uri.getScheme() + "://" + uri.getAuthority() + "/email/logo.png";
        } catch (URISyntaxException e) {
            throw new IllegalStateException("app.email.app-url is not a valid URI: " + appUrl, e);
        }
    }

    private String send(String toEmail, String subject, String plainText, String html) {
        return send(new String[] {toEmail}, subject, plainText, html);
    }

    // Returns the ACS messageId on success; throws EmailSendException if ACS's own completed
    // poll result reports anything other than SUCCEEDED. Previously this discarded
    // response.getValue() entirely (poller.waitForCompletion() then nothing read from the
    // result) -- a non-exception ACS failure (bad sender domain, auth issue, etc.) vanished
    // with zero trace anywhere. This is "send accepted" truth only -- whether the message is
    // later actually delivered, bounced, or spam-filtered is a separate, asynchronous truth
    // reported by Event Grid (see emaildelivery.EmailDeliveryWebhookController) and correlated
    // back to this send via the returned messageId.
    private String send(String[] toEmails, String subject, String plainText, String html) {
        EmailMessage message = new EmailMessage()
                .setSenderAddress(senderAddress)
                .setToRecipients(toEmails)
                .setSubject(subject)
                .setBodyPlainText(plainText);
        if (html != null) {
            message.setBodyHtml(html);
        }

        SyncPoller<EmailSendResult, EmailSendResult> poller = emailClient.beginSend(message);
        PollResponse<EmailSendResult> response = poller.waitForCompletion();
        EmailSendResult result = response.getValue();

        if (result.getStatus() != EmailSendStatus.SUCCEEDED) {
            throw new EmailSendException(describeFailure(result));
        }
        return result.getId();
    }

    private String describeFailure(EmailSendResult result) {
        ResponseError error = result.getError();
        String code = error != null ? error.getCode() : "unknown";
        String errorMessage = error != null ? error.getMessage() : "no error details returned by ACS";
        return "ACS send did not succeed: status=" + result.getStatus() + " code=" + code
                + " message=" + errorMessage;
    }

    private String plainTextVerificationCode(String code) {
        return "Your verification code is " + code + ". It expires in " + codeExpirationMinutes + " minutes.";
    }

    private String plainTextPasswordResetCode(String code) {
        return "Your password reset code is " + code + ". It expires in " + codeExpirationMinutes + " minutes.";
    }

    private String loadTemplate(String classpathLocation) {
        try {
            return new String(new ClassPathResource(classpathLocation).getInputStream().readAllBytes(),
                    StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to load email template: " + classpathLocation, e);
        }
    }
}
