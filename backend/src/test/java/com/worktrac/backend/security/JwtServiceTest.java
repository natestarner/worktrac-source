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

        String token = jwtService.generateToken(1L, 2L, "admin@example.com", "ADMIN", 0);
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

    // ── Selection tokens ──────────────────────────────────────────────────────────────────────

    @Test
    void aSelectionTokenRoundTripsThroughItsOwnParser() {
        JwtService jwtService = newJwtService();

        String token = jwtService.generateSelectionToken(7L, "both@example.com", 3);
        Optional<SelectionPrincipal> parsed = jwtService.parseSelectionToken(token);

        assertTrue(parsed.isPresent());
        assertEquals(7L, parsed.get().userId());
        assertEquals("both@example.com", parsed.get().email());
        // Carried so the mint route can apply the same revocation check every session does.
        assertEquals(3, parsed.get().tokenVersion());
    }

    @Test
    void aSelectionTokenIsNotASession() {
        JwtService jwtService = newJwtService();

        String token = jwtService.generateSelectionToken(7L, "both@example.com", 0);

        assertTrue(jwtService.parseToken(token).isEmpty());
    }

    /**
     * ⚠️ THE TEST THE {@code scp} CHECK ACTUALLY EXISTS FOR, and it cannot be written by mutating
     * production code.
     *
     * <p>Removing the {@code scp} check and re-running everything else still passes: a selection
     * token carries no {@code accountId}, and the null guard rejects it anyway. So the refusal
     * looks proven while resting entirely on an absence — the belt hiding whether the braces work.
     *
     * <p>This mints the future mistake directly: a token carrying {@code scp} AND a perfectly good
     * {@code accountId}, exactly what "let the picker preselect something" would produce. Nothing
     * but the {@code scp} check stands between that and a full thirty-day session, so if someone
     * deletes it, this is what goes red.
     */
    @Test
    void aRestrictedTokenIsRefusedEvenWhenItCarriesAnAccountId() {
        JwtService jwtService = newJwtService();
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        Instant now = Instant.now();

        String smuggled = Jwts.builder()
                .subject("7")
                .claim("accountId", 2L)
                .claim("email", "both@example.com")
                .claim("role", "USER")
                .claim("tv", 0)
                .claim("scp", "select")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(5, ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();

        assertTrue(jwtService.parseToken(smuggled).isEmpty());
    }

    /**
     * The other half of the polarity, and the reason absent-means-full is not laziness: every token
     * minted before {@code scp} existed carries none, and all of them have to keep working for
     * their full thirty days. Inverting this would sign out every existing user at deploy — the
     * same trap the {@code role} and {@code tv} claims already document.
     */
    @Test
    void aTokenWithNoScopeClaimIsStillAnOrdinarySession() {
        JwtService jwtService = newJwtService();
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        Instant now = Instant.now();

        String preExisting = Jwts.builder()
                .subject("7")
                .claim("accountId", 2L)
                .claim("email", "old@example.com")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(60, ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();

        Optional<AccountPrincipal> parsed = jwtService.parseToken(preExisting);
        assertTrue(parsed.isPresent());
        assertEquals(2L, parsed.get().accountId());
        assertEquals("USER", parsed.get().role());
    }

    @Test
    void anOrdinarySessionIsNotASelectionToken() {
        JwtService jwtService = newJwtService();

        String token = jwtService.generateToken(1L, 2L, "solo@example.com", "USER", 0);

        assertTrue(jwtService.parseSelectionToken(token).isEmpty());
    }
}
