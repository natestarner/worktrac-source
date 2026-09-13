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
     * ⚠️ <b>THE DEPLOY-DAY TRAP, pinned at last.</b>
     *
     * <p>{@code tv} is compared against the live {@code users} row on every request, and a
     * never-bumped row reads <b>0</b>. Every token minted before the claim existed carries none at
     * all, so "absent" has to parse as 0 — anything else makes every one of those tokens mismatch
     * and signs out <b>every existing user at the moment of deploy</b>.
     *
     * <p>Nothing asserted this. The polarity was documented in three comments and enforced by a
     * single {@code == null ? 0 :} that any refactor could have quietly changed, and the entire
     * suite would still have passed: every other test mints its tokens through {@code JwtService},
     * which always writes the claim. Only a token built WITHOUT it, by hand, can catch this — which
     * is exactly the shape of token this defends.
     *
     * <p>It matters more since {@code TokenAuthenticator} made this check reachable from a second
     * caller ({@code POST /api/auth/session}): the blast radius of getting it wrong is now every
     * route, not just the filtered ones.
     */
    @Test
    void aTokenWithNoVersionClaimReadsAsZeroAndKeepsWorking() {
        JwtService jwtService = newJwtService();
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        Instant now = Instant.now();

        String legacy = Jwts.builder()
                .subject("11")
                .claim("accountId", 4L)
                .claim("email", "before-tv-existed@example.com")
                .claim("role", "USER")
                // No "tv" claim at all -- this is what a token minted before V59 looks like.
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(30, ChronoUnit.DAYS)))
                .signWith(key)
                .compact();

        var parsed = jwtService.parseToken(legacy);

        assertTrue(parsed.isPresent(), "a pre-tv token must still parse, or every existing "
                + "session dies at deploy");
        // 0, so it MATCHES a never-bumped users row. Not -1, not a sentinel: the number has to be
        // the one the database holds for somebody who has never changed their password.
        assertEquals(0, parsed.get().tokenVersion());
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
