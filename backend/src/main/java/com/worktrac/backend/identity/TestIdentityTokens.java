package com.worktrac.backend.identity;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.worktrac.backend.config.EmailProperties;
import org.springframework.context.annotation.Profile;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Date;
import java.util.List;

/**
 * A stand-in identity provider for the e2e suite, which cannot drive real Apple or Google sign-in
 * (both put bot checks in the way, and automating past those is off the table).
 *
 * <p><b>Never present in production, by two independent gates</b>, the same pair
 * {@code TestSupportController} uses:
 * <ol>
 *   <li>{@code @Profile({"local", "lower"})} -- Spring does not create this bean anywhere else, so
 *       {@link IdTokenVerifier#isAvailable} answers false for {@link IdentityProvider#TEST};</li>
 *   <li>{@link #isEnabled} also needs the e2e test-support key, which only local and lower set.</li>
 * </ol>
 * {@code TestIdentityTokensProfileTest} fails if the profile list ever grows.
 *
 * <p>Tokens are HS256 under a key DERIVED from the test-support key, not the key itself, so a
 * token never carries anything that would let its holder call the other test-support routes. A
 * derived key rather than a generated one because lower runs more than one replica: a token minted
 * on one must verify on another.
 */
@Component
@Profile({"local", "lower"})
public class TestIdentityTokens {

    public static final String ISSUER = "https://test-idp.huddle.invalid";
    public static final String AUDIENCE = "huddle-test-client";

    private final EmailProperties emailProperties;

    public TestIdentityTokens(EmailProperties emailProperties) {
        this.emailProperties = emailProperties;
    }

    public boolean isEnabled() {
        String key = emailProperties.getTestSupportKey();
        return key != null && !key.isBlank();
    }

    NimbusJwtDecoder decoder() {
        return NimbusJwtDecoder.withSecretKey(secretKey()).macAlgorithm(MacAlgorithm.HS256).build();
    }

    /**
     * Mints an ID token the way a provider would. Every claim is the caller's to choose, including
     * wrong ones, so the e2e suite can prove a bad token is refused through the real route.
     */
    public String mint(String subject, String email, boolean emailVerified, String rawNonce,
                       String audience, Instant issuedAt, Instant expiresAt) {
        if (!isEnabled()) {
            throw new IllegalStateException("The test identity provider is not enabled");
        }
        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject(subject)
                .audience(List.of(audience == null ? AUDIENCE : audience))
                .issueTime(Date.from(issuedAt))
                .expirationTime(Date.from(expiresAt))
                .claim("email_verified", emailVerified);
        if (email != null) {
            claims.claim("email", email);
        }
        if (rawNonce != null) {
            claims.claim("nonce", IdTokenVerifier.sha256Hex(rawNonce));
        }
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims.build());
            jwt.sign(new MACSigner(secretKey()));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException("Could not sign a test ID token", e);
        }
    }

    private SecretKey secretKey() {
        try {
            byte[] derived = MessageDigest.getInstance("SHA-256").digest(
                    ("huddle-test-identity-provider:" + emailProperties.getTestSupportKey())
                            .getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(derived, "HmacSHA256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }
}
