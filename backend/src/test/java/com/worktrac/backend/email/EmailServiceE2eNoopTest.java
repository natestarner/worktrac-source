package com.worktrac.backend.email;

import com.worktrac.backend.config.EmailProperties;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

// Pure unit test (no Spring context) for the e2e-noop short-circuit added to
// EmailService.send() -- constructs a real EmailService (not @MockitoBean'd, unlike every
// other backend test) so the no-op check itself is genuinely exercised, using a syntactically
// valid but fake ACS connection string. This only works because EmailClientBuilder.buildClient()
// doesn't touch the network at construction time -- only an actual send would -- and the
// no-op check returns before any send is attempted.
class EmailServiceE2eNoopTest {

    private EmailProperties properties(String noopPattern) {
        EmailProperties properties = new EmailProperties();
        properties.setConnectionString(
                "endpoint=https://fake-resource.communication.azure.com/;accesskey=ZmFrZWFjY2Vzc2tleWZvcnRlc3Rpbmc=");
        properties.setSenderAddress("DoNotReply@example.com");
        properties.setAppUrl("http://localhost:3000/app/log");
        properties.setCodeExpirationMinutes(15);
        properties.setE2eNoopRecipientPattern(noopPattern);
        return properties;
    }

    @Test
    void aRecipientMatchingThePatternSkipsTheRealSendAndReturnsASyntheticMessageId() {
        EmailService emailService = new EmailService(properties("^huddle\\+e2e-.*@starner\\.co$"));

        String messageId = emailService.sendVerificationCode("huddle+e2e-123-abc@starner.co", "123456");

        assertTrue(messageId.startsWith("noop-"), "expected a synthetic no-op messageId, got: " + messageId);
    }

    @Test
    void matchingIsCaseInsensitive() {
        EmailService emailService = new EmailService(properties("^huddle\\+e2e-.*@starner\\.co$"));

        String messageId = emailService.sendVerificationCode("HUDDLE+E2E-123-ABC@STARNER.CO", "123456");

        assertTrue(messageId.startsWith("noop-"));
    }

    // The literal application-local.yml and application-lower.yml actually carry. It is load-bearing
    // for TWO addresses now, not one: the e2e households AND this environment's ADMIN_EMAILS
    // (nate+huddleadmin@starner.co, per worktrac-deploy's config/{lower,production}/backend-env.json).
    // The admin one matters because the Contact Us alert mails the ADMIN rather than the submitter,
    // so a pattern that misses it sends real ACS mail on every e2e run. Pinned here because the two
    // yml files hold independently-maintained copies of this regex.
    private static final String DEPLOYED_NOOP_PATTERN = "^(huddle\\+e2e-.*|nate\\+huddleadmin)@starner\\.co$";

    @Test
    void theConfiguredPatternCoversBothAnE2eHouseholdAndTheAdminAlertRecipient() {
        EmailService emailService = new EmailService(properties(DEPLOYED_NOOP_PATTERN));

        assertTrue(emailService.sendVerificationCode("huddle+e2e-123-abc@starner.co", "123456").startsWith("noop-"));
        assertTrue(emailService.sendAdminAlert(java.util.Set.of("nate+huddleadmin@starner.co"), "subj", "body")
                .startsWith("noop-"), "the Contact Us alert recipient must be no-op'd, or e2e sends real mail");
    }

    // live-email-canary.spec.ts depends on its address falling OUTSIDE the pattern, so widening it
    // for the admin address must not accidentally swallow that one too.
    @Test
    void theCanaryAddressStillFallsOutsideThePattern() {
        EmailService emailService = new EmailService(properties(DEPLOYED_NOOP_PATTERN));

        assertTrue(assertThrowsAnything(
                () -> emailService.sendVerificationCode("huddle+livewiretest-1@starner.co", "123456")));
    }

    @Test
    void aBlankPatternMeansNoOpIsNeverEligible() {
        EmailService emailService = new EmailService(properties(""));

        // With no pattern configured (production's real state), send() must fall through to the
        // real path -- proven here by it actually attempting the real ACS call and failing
        // against the fake endpoint, rather than silently returning a synthetic messageId.
        assertTrue(assertThrowsAnything(() -> emailService.sendVerificationCode("huddle+e2e-x@starner.co", "123456")));
    }

    private boolean assertThrowsAnything(Runnable action) {
        try {
            action.run();
            return false;
        } catch (Exception e) {
            return true;
        }
    }
}
