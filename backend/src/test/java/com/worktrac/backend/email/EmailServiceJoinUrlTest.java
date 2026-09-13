package com.worktrac.backend.email;

import com.worktrac.backend.config.EmailProperties;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

// Pure unit test (no Spring context), same shape as EmailServiceE2eNoopTest -- joinUrl() does no
// I/O, so this constructs a real EmailService directly rather than mocking it away.
//
// ⚠️ `appUrl` here is deliberately configured WITH a path (`/app/log`), matching what
// APP_EMAIL_APP_URL actually holds in every real environment (confirmed live via
// `az containerapp show` for both worktrac-backend-lower and worktrac-backend-prod, 2026-09-08) --
// not a bare origin. joinUrl() used to concatenate straight onto appUrl and produce
// `.../app/log/join?...`, a path the SPA's router has no route for; the catch-all silently sent
// every invite link to /login with no error and no explanation. A test built against a bare-origin
// appUrl would never have caught this -- it has to use the shape actually deployed.
class EmailServiceJoinUrlTest {

    private EmailService emailService() {
        EmailProperties properties = new EmailProperties();
        properties.setConnectionString(
                "endpoint=https://fake-resource.communication.azure.com/;accesskey=ZmFrZWFjY2Vzc2tleWZvcnRlc3Rpbmc=");
        properties.setSenderAddress("DoNotReply@example.com");
        properties.setAppUrl("https://app.dev.huddle.fitness/app/log");
        properties.setCodeExpirationMinutes(15);
        return new EmailService(properties);
    }

    @Test
    void joinUrlLandsOnTheAppsOriginNotOnAppUrlsOwnPath() {
        String url = emailService().joinUrl(42L, "some-token");

        assertEquals("https://app.dev.huddle.fitness/join?i=42&t=some-token", url);
    }

    @Test
    void tokenAndIdAreUrlEncoded() {
        // A token containing characters that mean something in a URL ('+' and '/' are both valid
        // Base64URL... this uses characters that need escaping regardless) must not corrupt the
        // query string it sits in.
        String url = emailService().joinUrl(7L, "a b&c");

        assertEquals("https://app.dev.huddle.fitness/join?i=7&t=a+b%26c", url);
    }
}
