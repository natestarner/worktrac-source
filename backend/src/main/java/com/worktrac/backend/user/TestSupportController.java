package com.worktrac.backend.user;

import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.registrationaudit.RegistrationEvent;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.user.dto.EmailOutcomeResponse;
import com.worktrac.backend.user.dto.PendingCodeResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;
import java.util.Set;

// Exists only so Playwright e2e tests (which can't read a real inbox) can retrieve a
// registration's verification code. Never present at all outside local/lower -- @Profile means
// Spring doesn't register this bean/route in production regardless of any request, and the
// shared-secret header is a second, independent gate on top of that: a misconfigured
// SPRING_PROFILES_ACTIVE alone can't expose another user's code. Any failure (wrong profile,
// missing/wrong header, no pending code for the email) returns 404 rather than 401/403, so an
// unauthenticated caller can't even confirm the route exists.
@RestController
@Profile({"local", "lower"})
public class TestSupportController {

    private static final Set<RegistrationEventType> VERIFICATION_EMAIL_OUTCOMES =
            Set.of(RegistrationEventType.VERIFICATION_EMAIL_SENT, RegistrationEventType.VERIFICATION_EMAIL_FAILED);

    private final TestCodeCache testCodeCache;
    private final EmailProperties emailProperties;
    private final RegistrationEventRepository registrationEventRepository;

    public TestSupportController(TestCodeCache testCodeCache, EmailProperties emailProperties,
                                  RegistrationEventRepository registrationEventRepository) {
        this.testCodeCache = testCodeCache;
        this.emailProperties = emailProperties;
        this.registrationEventRepository = registrationEventRepository;
    }

    @GetMapping("/api/auth/test/pending-code")
    public ResponseEntity<PendingCodeResponse> pendingCode(
            @RequestParam String email,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        String code = testCodeCache.get(email.trim().toLowerCase());
        if (code == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(new PendingCodeResponse(code));
    }

    // Backs the live-email-canary e2e spec -- the one spec whose recipient deliberately doesn't
    // match EmailService's e2e-noop pattern, so it triggers a real Azure Communication Services
    // send. Registering + confirming successfully doesn't prove that send actually worked (the
    // verification code is written to TestCodeCache synchronously, independent of whether the
    // async email dispatch that follows succeeds, fails, or gets no-op'd) -- this endpoint lets
    // that spec check the real outcome recorded in registration_events instead.
    @GetMapping("/api/auth/test/email-outcome")
    public ResponseEntity<EmailOutcomeResponse> emailOutcome(
            @RequestParam String email,
            @RequestHeader(value = "X-E2E-Test-Key", required = false) String testKey) {
        if (!keyMatches(testKey)) {
            return ResponseEntity.notFound().build();
        }
        Optional<RegistrationEvent> event = registrationEventRepository
                .findFirstByEmailAndEventTypeInOrderByCreatedAtDesc(email.trim().toLowerCase(),
                        VERIFICATION_EMAIL_OUTCOMES);
        if (event.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        RegistrationEvent latest = event.get();
        String status = latest.getEventType() == RegistrationEventType.VERIFICATION_EMAIL_SENT ? "SENT" : "FAILED";
        return ResponseEntity.ok(new EmailOutcomeResponse(status, latest.getMessageId(), latest.getDetail()));
    }

    private boolean keyMatches(String suppliedKey) {
        String expectedKey = emailProperties.getTestSupportKey();
        if (expectedKey == null || expectedKey.isBlank() || suppliedKey == null) {
            return false;
        }
        // Constant-time comparison -- this guards a real (if narrow) secret.
        return MessageDigest.isEqual(
                expectedKey.getBytes(StandardCharsets.UTF_8),
                suppliedKey.getBytes(StandardCharsets.UTF_8));
    }
}
