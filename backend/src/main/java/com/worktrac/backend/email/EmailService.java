package com.worktrac.backend.email;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.EmailClientBuilder;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import com.worktrac.backend.config.EmailProperties;
import org.springframework.stereotype.Service;

@Service
public class EmailService {

    private final EmailClient emailClient;
    private final String senderAddress;
    private final int codeExpirationMinutes;

    public EmailService(EmailProperties properties) {
        this.emailClient = new EmailClientBuilder()
                .connectionString(properties.getConnectionString())
                .buildClient();
        this.senderAddress = properties.getSenderAddress();
        this.codeExpirationMinutes = properties.getCodeExpirationMinutes();
    }

    public void sendVerificationCode(String toEmail, String code) {
        EmailMessage message = new EmailMessage()
                .setSenderAddress(senderAddress)
                .setToRecipients(toEmail)
                .setSubject("Your Workout Tracker verification code")
                .setBodyPlainText(plainTextBody(code))
                .setBodyHtml(htmlBody(code));

        SyncPoller<EmailSendResult, EmailSendResult> poller = emailClient.beginSend(message);
        PollResponse<EmailSendResult> response = poller.waitForCompletion();
        response.getValue();
    }

    private String plainTextBody(String code) {
        return "Your verification code is " + code + ". It expires in " + codeExpirationMinutes + " minutes.";
    }

    private String htmlBody(String code) {
        return "<p>Your verification code is <strong>" + code + "</strong>. It expires in "
                + codeExpirationMinutes + " minutes.</p>";
    }
}
