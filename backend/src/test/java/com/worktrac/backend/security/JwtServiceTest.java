package com.worktrac.backend.security;

import com.worktrac.backend.config.JwtProperties;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// Plain unit test (no Spring context) -- JwtService only depends on JwtProperties, a
// simple POJO, so there's no need to pay for a full application context here.
class JwtServiceTest {

    private static final String SECRET = "unit-test-only-jwt-signing-secret-do-not-use-elsewhere-0123456789";

    private JwtService newJwtService() {
        JwtProperties properties = new JwtProperties();
        properties.setSecret(SECRET);
        properties.setExpirationMinutes(60);
        return new JwtService(properties);
    }

    @Test
    void tokenRoundTripsRoleClaim() {
        JwtService jwtService = newJwtService();

        String token = jwtService.generateToken(1L, 2L, "admin@example.com", "ADMIN");
        Optional<AccountPrincipal> parsed = jwtService.parseToken(token);

        assertTrue(parsed.isPresent());
        assertEquals("ADMIN", parsed.get().role());
        assertEquals(1L, parsed.get().userId());
        assertEquals(2L, parsed.get().accountId());
        assertEquals("admin@example.com", parsed.get().email());
    }

    @Test
    void legacyTokenWithoutRoleClaimDefaultsToUser() {
        // Simulates a token minted before the role claim existed (a real 30-day-old token
        // still in someone's localStorage at deploy time) -- must not break parsing, and
        // must default to the least-privileged role rather than failing open as ADMIN.
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        Instant now = Instant.now();
        String legacyToken = Jwts.builder()
                .subject("1")
                .claim("accountId", 2L)
                .claim("email", "legacy@example.com")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(30, ChronoUnit.DAYS)))
                .signWith(key)
                .compact();

        Optional<AccountPrincipal> parsed = newJwtService().parseToken(legacyToken);

        assertTrue(parsed.isPresent());
        assertEquals("USER", parsed.get().role());
    }

    @Test
    void malformedTokenParsesToEmpty() {
        assertTrue(newJwtService().parseToken("not-a-real-token").isEmpty());
    }
}
