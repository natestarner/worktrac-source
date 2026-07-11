package com.worktrac.backend.user;

import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.user.dto.PendingCodeResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

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

    private final TestCodeCache testCodeCache;
    private final EmailProperties emailProperties;

    public TestSupportController(TestCodeCache testCodeCache, EmailProperties emailProperties) {
        this.testCodeCache = testCodeCache;
        this.emailProperties = emailProperties;
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
