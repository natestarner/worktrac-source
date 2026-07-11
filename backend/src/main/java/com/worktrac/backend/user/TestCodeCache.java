package com.worktrac.backend.user;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

// Holds the raw (unhashed) verification code per email, purely so the local/lower-only
// test-support endpoint can hand it to Playwright e2e tests -- only the BCrypt hash is ever
// persisted in pending_registrations. Only exists as a bean in local/lower (see @Profile), so
// RegistrationService injects this as Optional<TestCodeCache>: in production the optional is
// always empty, and no raw code is ever held anywhere outside the profiles that need it.
@Component
@Profile({"local", "lower"})
public class TestCodeCache {

    private final ConcurrentHashMap<String, String> codesByEmail = new ConcurrentHashMap<>();

    public void put(String email, String rawCode) {
        codesByEmail.put(email, rawCode);
    }

    public String get(String email) {
        return codesByEmail.get(email);
    }
}
