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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collection;
import java.util.Locale;
import java.util.UUID;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final EmailClient emailClient;
    private final String senderAddress;
    private final String membershipInviteTemplate;
    private final String simpleNoticeTemplate;
    private final String appUrl;
    private final String logoUrl;
    private final int codeExpirationMinutes;
    private final String verificationCodeTemplate;
    private final String registrationSuccessTemplate;
    private final String passwordResetCodeTemplate;
    private final String passwordResetSuccessTemplate;
    private final Pattern e2eNoopRecipientPattern;

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
        this.membershipInviteTemplate = loadTemplate("templates/email/membership-invite.html");
        this.simpleNoticeTemplate = loadTemplate("templates/email/simple-notice.html");
        String noopPattern = properties.getE2eNoopRecipientPattern();
        this.e2eNoopRecipientPattern = (noopPattern == null || noopPattern.isBlank())
                ? null
                : Pattern.compile(noopPattern);
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

    /**
     * Invites someone to take over a person in a household as their own login.
     *
     * <p>⚠️ <b>The BODY differs by whether the recipient already has a Huddle account; nothing the
     * OWNER sees does.</b> That asymmetry is the whole design — see
     * {@code MembershipInviteService}'s class comment for why an owner-visible difference would be
     * a user-enumeration oracle. Here it is only about giving the recipient the right instruction:
     * one of them needs to choose a password, the other already has one.
     *
     * <p>Carries the transparency sentence — what the owner can and cannot do — because a member's
     * first contact with this feature is this email, not the app. It says the same thing the
     * Profile page does, deliberately.
     */
    public String sendMembershipInvite(String toEmail, String personName, String householdName,
                                        String ownerName, String joinUrl, boolean recipientHasAccount) {
        String actionSentence = recipientHasAccount
                ? "Open the link below and sign in with the password you already use for Huddle."
                : "Open the link below to choose a password and finish setting up your login.";
        String buttonLabel = recipientHasAccount ? "Join " + householdName : "Set up my login";

        String html = membershipInviteTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{JOIN_URL}}", joinUrl)
                .replace("{{ACTION_SENTENCE}}", actionSentence)
                .replace("{{BUTTON_LABEL}}", buttonLabel)
                // Every one of these is somebody's typed text reaching an HTML document, so it is
                // escaped rather than interpolated raw. OWNER_NAME and PERSON_NAME are person
                // names and HOUSEHOLD_NAME is an account name -- all free text the household chose.
                .replace("{{PERSON_NAME}}", escapeHtml(personName))
                .replace("{{HOUSEHOLD_NAME}}", escapeHtml(householdName))
                .replace("{{OWNER_NAME}}", escapeHtml(ownerName));

        String plain = ownerName + " set up a Huddle login for you as " + personName
                + " in " + householdName + ". " + actionSentence + " " + joinUrl
                + "  This link expires in 7 days. " + ownerName + " can see your workouts and can"
                + " remove your login, but cannot see or set your password.";

        return send(toEmail, ownerName + " set up a Huddle login for you", plain, html);
    }

    // Minimal, and deliberately not a dependency: these values land in attribute-free text nodes
    // in the template above, so the five XML predefined entities are the whole exposure. Ampersand
    // first, or it would double-escape the others.
    private static String escapeHtml(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    /**
     * To the new member, once they have joined: which household, and the way out.
     *
     * <p>Carries the one-click exit deliberately. Being added to somebody else's household with no
     * visible way to leave is the shape of a trap regardless of intent, and this is the message
     * they will still have in their inbox months later when they want it.
     */
    public String sendAddedToHousehold(String toEmail, String personName, String householdName,
                                        String ownerName) {
        String html = simpleNoticeTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{HEADING}}", escapeHtml("You're in " + householdName))
                .replace("{{BODY}}", escapeHtml("You're now logging as " + personName + " in "
                        + householdName + ". " + ownerName + " can see your workouts and can remove"
                        + " your login, but cannot see or set your password.")
                        + "<br><br>You can leave this household at any time from Profile &rarr; "
                        + "Leave household.")
                .replace("{{CTA_URL}}", appUrl)
                .replace("{{CTA_LABEL}}", "Open Huddle");

        return send(toEmail, "You've joined " + householdName + " on Huddle",
                "You're now logging as " + personName + " in " + householdName + ". "
                        + ownerName + " can see your workouts and can remove your login, but cannot"
                        + " see or set your password. You can leave at any time from Profile."
                        + " Open Huddle: " + appUrl,
                html);
    }

    /**
     * To the OWNER, when an invitation is accepted, NAMING the address that accepted it.
     *
     * <p>⚠️ This is the typo detector, and the reason it is not optional. A mistyped invite gives a
     * stranger read access to the household's whole training history — visibility is forced on for
     * Pro/Family — and nothing else in the system would ever surface it. The address has to be in
     * the message; "somebody accepted" would be useless.
     */
    public String sendInviteAccepted(String toEmail, String memberEmail, String personName,
                                      String householdName) {
        String html = simpleNoticeTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{HEADING}}", escapeHtml(personName + " has a login now"))
                .replace("{{BODY}}", escapeHtml(memberEmail) + " accepted your invitation and can now"
                        + " sign in as " + escapeHtml(personName) + " in "
                        + escapeHtml(householdName) + ".<br><br>If that address is not who you meant"
                        + " to invite, remove the login from Profile &rarr; Logins straight away —"
                        + " they can see everyone's workouts.")
                .replace("{{CTA_URL}}", appUrl + "/app/profile")
                .replace("{{CTA_LABEL}}", "Review logins");

        return send(toEmail, personName + " accepted their Huddle login",
                memberEmail + " accepted your invitation and can now sign in as " + personName
                        + " in " + householdName + ". If that is not who you meant to invite, remove"
                        + " the login from Profile > Logins straight away -- they can see everyone's"
                        + " workouts. " + appUrl + "/app/profile",
                html);
    }

    /**
     * To the person who lost access.
     *
     * <p>⚠️ A security control, not a courtesy. Without it they are silently signed out, and their
     * queued offline writes can then never land — see {@code offline-internals.md}. They deserve to
     * know that before they wonder where their sets went.
     */
    public String sendLoginRevoked(String toEmail, String householdName, String ownerName,
                                    boolean wasOnlyAnInvitation) {
        String heading = wasOnlyAnInvitation
                ? "Your invitation to " + householdName + " was withdrawn"
                : "Your login for " + householdName + " was removed";
        String body = wasOnlyAnInvitation
                ? ownerName + " withdrew the invitation to join " + householdName + ". Nothing was"
                        + " set up, and there is nothing you need to do."
                : ownerName + " removed your login for " + householdName + ". Your workouts stay in"
                        + " that household — they were never yours to take with you — and anything"
                        + " you logged on a device that was offline may not have synced before"
                        + " access ended. Your Huddle account and any other households are"
                        + " unaffected.";

        String html = simpleNoticeTemplate
                .replace("{{LOGO_URL}}", logoUrl)
                .replace("{{HEADING}}", escapeHtml(heading))
                .replace("{{BODY}}", escapeHtml(body))
                .replace("{{CTA_URL}}", appUrl)
                .replace("{{CTA_LABEL}}", "Open Huddle");

        return send(toEmail, heading, body + " " + appUrl, html);
    }

    /**
     * The link an invite email points at.
     *
     * <p>Built here because {@code appUrl} lives here — the one place that knows which origin the
     * app is served from in this environment. A caller assembling it would need that config
     * threaded to it, and would drift the moment a second caller appeared.
     *
     * <p>Carries the invite id AND the token: the id is the lookup (a BCrypt hash cannot be
     * searched for), and the token is the proof. URL-encoded because the token is Base64URL and
     * the id is a number, but the encoding is not optional — it is what stops a future token
     * alphabet change silently breaking every link.
     */
    public String joinUrl(Long inviteId, String rawToken) {
        return appUrl + "/join?i=" + URLEncoder.encode(String.valueOf(inviteId), StandardCharsets.UTF_8)
                + "&t=" + URLEncoder.encode(rawToken, StandardCharsets.UTF_8);
    }

    public String sendPasswordResetSuccess(String toEmail) {
        String html = passwordResetSuccessTemplate.replace("{{LOGO_URL}}", logoUrl);

        return send(toEmail, "Your Huddle password was changed",
                "The password on your Huddle account was just reset. If this wasn't you, reset it again right away.",
                html);
    }

    // Plain-text only (no template) -- this goes to the app's own admins, not end users, in
    // response to a registration event they've opted into via the alert-settings toggle.
    //
    // The plain-text-ness is load-bearing for the contact-form alert, whose body embeds text a
    // household member typed: with no HTML part there is nothing for markup in that text to inject
    // into. Do not give this an HTML template.
    //
    // Returns the ACS messageId, or null when there are no admins configured. Callers that only
    // fire-and-forget (AdminAlertEventListener) ignore it; ContactEmailEventListener stores it on
    // the message row so a send can later be correlated with its Event Grid delivery report.
    public String sendAdminAlert(Collection<String> toEmails, String subject, String body) {
        if (toEmails.isEmpty()) return null;
        return send(toEmails.toArray(new String[0]), subject, body, null);
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
    //
    // The e2e no-op check runs first: if e2eNoopRecipientPattern is configured (local/lower
    // only -- see EmailProperties) and every recipient matches it, this skips the real ACS call
    // entirely and returns a synthetic messageId instead. Everything above this method --
    // RegistrationEmailEventListener, RegistrationAuditService, the Activity tab -- runs exactly
    // as it would for a real send; only the actual network call to Azure is skipped. Requiring
    // ALL recipients to match (not just one) means a mixed-recipient send (not something this
    // app currently does, but a real guarantee worth keeping) can never be silently half-skipped.
    private String send(String[] toEmails, String subject, String plainText, String html) {
        if (isE2eNoopRecipient(toEmails)) {
            String syntheticMessageId = "noop-" + UUID.randomUUID();
            log.info("Skipping real ACS send to e2e no-op recipient(s) {} (synthetic messageId={})",
                    String.join(",", toEmails), syntheticMessageId);
            return syntheticMessageId;
        }

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

    private boolean isE2eNoopRecipient(String[] toEmails) {
        if (e2eNoopRecipientPattern == null) {
            return false;
        }
        return Arrays.stream(toEmails)
                .allMatch(email -> e2eNoopRecipientPattern.matcher(email.toLowerCase(Locale.ROOT)).matches());
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
