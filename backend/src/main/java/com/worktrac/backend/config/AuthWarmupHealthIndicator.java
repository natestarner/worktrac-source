package com.worktrac.backend.config;

import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

// BCrypt (used by /api/auth/register and /login, see SecurityConfig) is deliberately
// CPU-heavy, and a freshly started JVM hasn't JIT-compiled that code path yet -- so
// /actuator/health could report UP well before the first real registration/login is
// actually fast. That gap is what made worktrac-deploy's post-deploy readiness poll
// (see the wait-for-url composite action) declare the backend ready while the very
// first registration in the e2e suite still timed out. This indicator forces one real
// encode/verify round trip before contributing UP, so readiness only reports true once
// the expensive path has actually run and warmed. Runs exactly once per JVM lifetime
// (not on every poll) so it doesn't tax an endpoint that infra may poll frequently.
@Component
public class AuthWarmupHealthIndicator implements HealthIndicator {

    private static final String PROBE_VALUE = "warmup-check";

    private final PasswordEncoder passwordEncoder;
    private final AtomicBoolean warmed = new AtomicBoolean(false);

    public AuthWarmupHealthIndicator(PasswordEncoder passwordEncoder) {
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public Health health() {
        if (warmed.get()) {
            return Health.up().build();
        }
        try {
            String hash = passwordEncoder.encode(PROBE_VALUE);
            if (!passwordEncoder.matches(PROBE_VALUE, hash)) {
                return Health.down().withDetail("reason", "password encoder round-trip mismatch").build();
            }
            warmed.set(true);
            return Health.up().build();
        } catch (RuntimeException e) {
            return Health.down(e).build();
        }
    }
}
