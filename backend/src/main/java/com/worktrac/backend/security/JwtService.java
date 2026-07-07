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

    public String generateToken(Long userId, Long accountId, String email) {
        Instant now = Instant.now();
        Instant expiry = now.plus(jwtProperties.getExpirationMinutes(), ChronoUnit.MINUTES);
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("accountId", accountId)
                .claim("email", email)
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
            return Optional.of(new AccountPrincipal(userId, accountId, email));
        } catch (JwtException | IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
