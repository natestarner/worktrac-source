package com.worktrac.backend.email;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.EmailClientBuilder;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
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

@Service
public class EmailService {

    private final EmailClient emailClient;
    private final String senderAddress;
    private final String appUrl;
    private final String logoUrl;
    private final int codeExpirationMinutes;
    private final String verificationCodeTemplate;
    private final String registrationSuccessTemplate;

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
    }

    public void sendVerificationCode(String toEmail, String code) {
        String html = verificationCodeTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{CODE_PART_1}}", code.substring(0, 3))
                .replace("{{CODE_PART_2}}", code.substring(3))
                .replace("{{EXPIRATION_MINUTES}}", String.valueOf(codeExpirationMinutes));

        send(toEmail, "Your Huddle verification code", plainTextVerificationCode(code), html);
    }

    public void sendRegistrationSuccess(String toEmail) {
        String html = registrationSuccessTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{APP_URL}}", appUrl);

        send(toEmail, "You're all set! Your Huddle account is confirmed",
                "Your Huddle account is confirmed and ready to go. Open the app: " + appUrl, html);
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

    private void send(String toEmail, String subject, String plainText, String html) {
        EmailMessage message = new EmailMessage()
                .setSenderAddress(senderAddress)
                .setToRecipients(toEmail)
                .setSubject(subject)
                .setBodyPlainText(plainText)
                .setBodyHtml(html);

        SyncPoller<EmailSendResult, EmailSendResult> poller = emailClient.beginSend(message);
        PollResponse<EmailSendResult> response = poller.waitForCompletion();
        response.getValue();
    }

    private String plainTextVerificationCode(String code) {
        return "Your verification code is " + code + ". It expires in " + codeExpirationMinutes + " minutes.";
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
