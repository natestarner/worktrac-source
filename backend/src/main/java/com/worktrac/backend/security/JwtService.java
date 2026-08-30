package com.worktrac.backend.security;

import com.worktrac.backend.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.Optional;

@Service
public class JwtService {

    private final JwtProperties jwtProperties;
    private final SecretKey key;

    public JwtService(JwtProperties jwtProperties) {
        this.jwtProperties = jwtProperties;
        this.key = Keys.hmacShaKeyFor(jwtProperties.getSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String generateToken(Long userId, Long accountId, String email, String role, int tokenVersion) {
        Instant now = Instant.now();
        Instant expiry = now.plus(jwtProperties.getExpirationMinutes(), ChronoUnit.MINUTES);
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("accountId", accountId)
                .claim("email", email)
                .claim("role", role)
                // Lets a token be invalidated before its 30-day expiry -- see V59 and
                // JwtAuthenticationFilter. Absent on tokens minted before this existed, which
                // parse as 0 and match a never-bumped row.
                .claim("tv", tokenVersion)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry))
                .signWith(key)
                .compact();
    }

    // Empty on any invalid/expired/malformed token -- callers treat that as "not authenticated."
    public Optional<AccountPrincipal> parseToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Long userId = Long.valueOf(claims.getSubject());
            Long accountId = claims.get("accountId", Number.class).longValue();
            String email = claims.get("email", String.class);
            // Defaults to USER for tokens issued before the role claim existed, so
            // pre-existing 30-day tokens keep working without forcing a re-login.
            String role = claims.get("role", String.class);
            // Same backward-compatibility shape as the role claim above: a token minted before
            // the claim existed reads as 0, which matches a row that has never been bumped, so
            // existing 30-day tokens keep working rather than all being invalidated at deploy.
            Number tokenVersion = claims.get("tv", Number.class);
            return Optional.of(new AccountPrincipal(userId, accountId, email, role == null ? "USER" : role,
                    tokenVersion == null ? 0 : tokenVersion.intValue()));
        } catch (JwtException | IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
