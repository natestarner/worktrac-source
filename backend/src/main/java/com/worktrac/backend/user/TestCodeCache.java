package com.worktrac.backend.user;

import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

// Holds the raw (unhashed) verification code per email, purely so the local/lower-only
// test-support endpoint can hand it to Playwright e2e tests -- only the BCrypt hash is ever
// persisted in pending_registrations. Only exists as a bean in local/lower (see @Profile), so
// RegistrationService injects this as Optional<TestCodeCache>: in production the optional is
// always empty, and no raw code is ever held anywhere outside the profiles that need it.
//
// Stored in the test_codes table (V89), not a map in this JVM. The backend runs as several
// replicas, and even lower's single replica briefly becomes two while it scales from zero, so the
// request that issues a code and the e2e's request to read it back can land on different JVMs. A map
// answered that read with nothing; the table answers it from any replica.
//
// put() runs inside the issuing request's transaction (RegistrationService / PasswordResetService),
// so the code becomes visible exactly when the registration or reset it belongs to commits -- which
// is before the HTTP response the e2e is waiting on.
@Component
@Profile({"local", "lower"})
public class TestCodeCache {

    private final JdbcTemplate jdbc;

    public TestCodeCache(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void put(String email, String rawCode) {
        jdbc.update("MERGE test_codes AS target "
                        + "USING (SELECT ? AS email, ? AS code) AS source ON target.email = source.email "
                        + "WHEN MATCHED THEN UPDATE SET code = source.code, created_at = SYSUTCDATETIME() "
                        + "WHEN NOT MATCHED THEN INSERT (email, code) VALUES (source.email, source.code);",
                email, rawCode);
    }

    public String get(String email) {
        List<String> codes = jdbc.query("SELECT code FROM test_codes WHERE email = ?",
                (rs, n) -> rs.getString("code"), email);
        return codes.isEmpty() ? null : codes.getFirst();
    }
}
