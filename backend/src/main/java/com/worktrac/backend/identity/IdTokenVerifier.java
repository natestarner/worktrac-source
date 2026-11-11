package com.worktrac.backend.identity;

import com.nimbusds.jose.KeySourceException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/**
 * Turns an Apple or Google ID token into a {@link VerifiedIdentity}, or refuses it.
 *
 * <p><b>The cryptography is Spring Security's and Nimbus's, not ours.</b> {@link NimbusJwtDecoder}
 * fetches the provider's published keys (JWKS), caches them, re-fetches when a token names a key
 * it has not seen (providers rotate keys), checks the signature, and refuses {@code alg: none} and
 * any algorithm other than the one configured. This class adds only the claim checks each provider
 * needs, each of which is a named validator below with its own test in {@code IdTokenVerifierTest}.
 * Hand-written signature checks are how features like this usually go wrong; do not add one.
 *
 * <p><b>What every accepted token has proved</b>, all of which are required:
 * <ul>
 *   <li>signed by the provider's current key (RS256);</li>
 *   <li>{@code iss} is the provider;</li>
 *   <li>{@code aud} names one of THIS environment's client ids -- a token minted for another app,
 *       or for lower when this is production, is worthless here;</li>
 *   <li>{@code exp} not passed, judged by our injected {@link Clock} with a small skew;</li>
 *   <li>{@code iat} within {@code maxTokenAge} -- a stolen token goes stale fast;</li>
 *   <li>{@code nonce} equals SHA-256(the raw nonce the client holds), hex. The client generated
 *       the raw value, gave the provider only its hash, and sends us the raw value: a token lifted
 *       from a log or a proxy is useless without the raw value it was bound to;</li>
 *   <li>a non-blank {@code sub}.</li>
 * </ul>
 */
@Component
public class IdTokenVerifier {

    private static final OAuth2Error INVALID = new OAuth2Error("invalid_token");

    private final SocialSignInProperties properties;
    private final Clock clock;
    private final Optional<TestIdentityTokens> testTokens;
    private final Function<IdentityProvider, NimbusJwtDecoder> decoderFactory;
    // One decoder per provider, built on first use: building one fetches nothing, and the decoder
    // holds the JWKS cache, so it must be reused across requests rather than rebuilt per call.
    private final Map<IdentityProvider, NimbusJwtDecoder> decoders = new EnumMap<>(IdentityProvider.class);

    @Autowired
    public IdTokenVerifier(SocialSignInProperties properties, Clock clock,
                           Optional<TestIdentityTokens> testTokens) {
        this(properties, clock, testTokens, null);
    }

    /** For tests: supplies the signature-checking decoder; the claim validators are still ours. */
    IdTokenVerifier(SocialSignInProperties properties, Clock clock, Optional<TestIdentityTokens> testTokens,
                    Function<IdentityProvider, NimbusJwtDecoder> decoderFactory) {
        this.properties = properties;
        this.clock = clock;
        this.testTokens = testTokens;
        this.decoderFactory = decoderFactory != null ? decoderFactory : this::productionDecoder;
    }

    /**
     * Whether sign-in with this provider can work in this environment at all. False means the route
     * answers 404 -- the same as a provider that does not exist -- so a disabled feature reveals
     * nothing about how it would be configured.
     *
     * <p>⚠️ {@link IdentityProvider#TEST} is available only where a {@link TestIdentityTokens} bean
     * exists, which its {@code @Profile} confines to local and lower, AND only when the e2e key is
     * set. Production has neither. {@code IdTokenVerifierTest#theTestProviderDoesNotExistWithoutItsBean}
     * and {@code TestIdentityTokensProfileTest} pin both halves.
     */
    public boolean isAvailable(IdentityProvider provider) {
        return properties.isEnabled() && isConfigured(provider);
    }

    /**
     * Whether tokens from this provider CAN be checked here, whether or not new sign-ins are
     * switched on. Re-confirming an existing login (before deleting it, or setting its first
     * password) uses this rather than {@link #isAvailable}: switching the feature off must never
     * strand a login that has no password, with no way left to prove itself.
     */
    public boolean isConfigured(IdentityProvider provider) {
        if (provider == IdentityProvider.TEST) {
            return testTokens.map(TestIdentityTokens::isEnabled).orElse(false);
        }
        return properties.forProvider(provider).isConfigured();
    }

    /**
     * @throws InvalidIdTokenException      the token proves nothing (caller answers "couldn't confirm
     *                                      that sign-in")
     * @throws ProviderUnreachableException the provider's keys could not be fetched (caller answers
     *                                      503 "try again")
     * @throws IllegalStateException        the provider is not available -- callers check
     *                                      {@link #isAvailable} first
     */
    public VerifiedIdentity verify(IdentityProvider provider, String idToken, String rawNonce) {
        if (!isAvailable(provider)) {
            throw new IllegalStateException(provider + " sign-in is not available here");
        }
        return check(provider, idToken, rawNonce);
    }

    /**
     * {@link #verify} for re-confirming an EXISTING login: needs the provider configured, not the
     * feature switched on (see {@link #isConfigured}). Every token check is identical.
     */
    public VerifiedIdentity verifyForReconfirmation(IdentityProvider provider, String idToken, String rawNonce) {
        if (!isConfigured(provider)) {
            throw new IllegalStateException(provider + " is not configured here");
        }
        return check(provider, idToken, rawNonce);
    }

    private VerifiedIdentity check(IdentityProvider provider, String idToken, String rawNonce) {
        if (idToken == null || idToken.isBlank()) {
            throw new InvalidIdTokenException("empty token");
        }
        if (rawNonce == null || rawNonce.isBlank()) {
            throw new InvalidIdTokenException("no nonce supplied");
        }

        Jwt jwt;
        try {
            jwt = decoderFor(provider).decode(idToken);
        } catch (JwtValidationException e) {
            throw new InvalidIdTokenException("claims refused: " + describe(e), e);
        } catch (JwtException e) {
            if (causedByKeySource(e)) {
                throw new ProviderUnreachableException(
                        "Couldn't fetch " + provider.displayName() + "'s signing keys", e);
            }
            throw new InvalidIdTokenException("undecodable or badly signed: " + e.getMessage(), e);
        }

        // Checked here rather than as a validator so it can use the raw nonce of THIS request.
        String nonceClaim = jwt.getClaimAsString("nonce");
        if (nonceClaim == null || !MessageDigest.isEqual(
                nonceClaim.getBytes(StandardCharsets.UTF_8),
                sha256Hex(rawNonce).getBytes(StandardCharsets.UTF_8))) {
            throw new InvalidIdTokenException("nonce mismatch");
        }

        String email = jwt.getClaimAsString("email");
        return new VerifiedIdentity(
                provider,
                jwt.getSubject(),
                email == null || email.isBlank() ? null : email.trim().toLowerCase(Locale.ROOT),
                truthy(jwt.getClaims().get("email_verified")),
                truthy(jwt.getClaims().get("is_private_email")),
                // The one of OUR client ids this token was minted for. Apple's code exchange must
                // be made as that same client, so it is carried rather than guessed.
                jwt.getAudience().stream().filter(audiencesFor(provider)::contains).findFirst().orElseThrow());
    }

    /**
     * Verifies the signed JWT Apple POSTs to our server-to-server notification endpoint, and returns
     * its claims. Same keys, issuer and audience as an Apple ID token; differs in that it carries no
     * nonce (nobody on our side started it) and Apple does not promise an {@code exp} -- so instead
     * its {@code iat} must be within {@link #NOTIFICATION_MAX_AGE}, which still allows Apple's
     * retries while refusing a captured notification replayed much later.
     *
     * @throws InvalidIdTokenException      not a genuine, current Apple notification for our app
     * @throws ProviderUnreachableException Apple's keys could not be fetched
     */
    public Jwt verifyAppleNotification(String payload) {
        if (!isConfigured(IdentityProvider.APPLE)) {
            throw new IllegalStateException("Apple is not configured here");
        }
        if (payload == null || payload.isBlank()) {
            throw new InvalidIdTokenException("empty notification");
        }
        NimbusJwtDecoder decoder;
        synchronized (this) {
            if (appleNotificationDecoder == null) {
                appleNotificationDecoder = decoderFactory.apply(IdentityProvider.APPLE);
                appleNotificationDecoder.setJwtValidator(notificationValidator());
            }
            decoder = appleNotificationDecoder;
        }
        try {
            return decoder.decode(payload);
        } catch (JwtValidationException e) {
            throw new InvalidIdTokenException("notification claims refused: " + describe(e), e);
        } catch (JwtException e) {
            if (causedByKeySource(e)) {
                throw new ProviderUnreachableException("Couldn't fetch Apple's signing keys", e);
            }
            throw new InvalidIdTokenException("undecodable or badly signed notification: " + e.getMessage(), e);
        }
    }

    static final Duration NOTIFICATION_MAX_AGE = Duration.ofDays(3);

    private NimbusJwtDecoder appleNotificationDecoder;

    private OAuth2TokenValidator<Jwt> notificationValidator() {
        List<String> issuers = List.copyOf(properties.getApple().getIssuers());
        List<String> audiences = audiencesFor(IdentityProvider.APPLE);
        JwtTimestampValidator timestamps = new JwtTimestampValidator(properties.getClockSkew());
        timestamps.setClock(clock);
        return new DelegatingOAuth2TokenValidator<>(
                timestamps,
                jwt -> issuers.contains(jwt.getClaimAsString("iss"))
                        ? OAuth2TokenValidatorResult.success()
                        : failure("issuer " + jwt.getClaimAsString("iss") + " is not Apple"),
                jwt -> jwt.getAudience() != null && jwt.getAudience().stream().anyMatch(audiences::contains)
                        ? OAuth2TokenValidatorResult.success()
                        : failure("audience " + jwt.getAudience() + " is not one of this environment's client ids"),
                jwt -> {
                    Instant issuedAt = jwt.getIssuedAt();
                    Instant now = clock.instant();
                    if (issuedAt == null || issuedAt.isAfter(now.plus(properties.getClockSkew()))
                            || issuedAt.isBefore(now.minus(NOTIFICATION_MAX_AGE))) {
                        return failure("notification iat " + issuedAt + " is missing or out of range");
                    }
                    return OAuth2TokenValidatorResult.success();
                });
    }

    /** SHA-256 of the raw nonce, lower-case hex: what the client passes the provider as its nonce. */
    public static String sha256Hex(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }

    private synchronized NimbusJwtDecoder decoderFor(IdentityProvider provider) {
        return decoders.computeIfAbsent(provider, p -> {
            NimbusJwtDecoder decoder = p == IdentityProvider.TEST
                    ? testTokens.orElseThrow().decoder()
                    : decoderFactory.apply(p);
            decoder.setJwtValidator(validatorFor(p));
            return decoder;
        });
    }

    private NimbusJwtDecoder productionDecoder(IdentityProvider provider) {
        return NimbusJwtDecoder.withJwkSetUri(properties.forProvider(provider).getJwksUri())
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .build();
    }

    // Package-visible so the test can confirm it is the validator in force, not merely defined.
    OAuth2TokenValidator<Jwt> validatorFor(IdentityProvider provider) {
        List<String> issuers = provider == IdentityProvider.TEST
                ? List.of(TestIdentityTokens.ISSUER)
                : List.copyOf(properties.forProvider(provider).getIssuers());
        List<String> audiences = audiencesFor(provider);

        JwtTimestampValidator timestamps = new JwtTimestampValidator(properties.getClockSkew());
        timestamps.setClock(clock);
        // ⚠️ Spring's default ACCEPTS a token with no exp at all (IdTokenVerifierTest#aTokenWithNoExpiry
        // went red without this line). Apple and Google always send one, so a token without it is
        // not theirs; and one that never expires would be replayable forever but for the iat check.
        timestamps.setAllowEmptyExpiryClaim(false);

        return new DelegatingOAuth2TokenValidator<>(
                timestamps,
                jwt -> issuers.contains(jwt.getClaimAsString("iss"))
                        ? OAuth2TokenValidatorResult.success()
                        : failure("issuer " + jwt.getClaimAsString("iss") + " is not " + provider),
                jwt -> jwt.getAudience() != null && jwt.getAudience().stream().anyMatch(audiences::contains)
                        ? OAuth2TokenValidatorResult.success()
                        : failure("audience " + jwt.getAudience() + " is not one of this environment's client ids"),
                jwt -> jwt.getSubject() != null && !jwt.getSubject().isBlank()
                        ? OAuth2TokenValidatorResult.success()
                        : failure("no subject"),
                this::issuedRecently);
    }

    private List<String> audiencesFor(IdentityProvider provider) {
        return provider == IdentityProvider.TEST
                ? List.of(TestIdentityTokens.AUDIENCE)
                : List.copyOf(properties.forProvider(provider).getClientIds());
    }

    private OAuth2TokenValidatorResult issuedRecently(Jwt jwt) {
        Instant issuedAt = jwt.getIssuedAt();
        if (issuedAt == null) {
            return failure("no iat");
        }
        Instant now = clock.instant();
        Duration skew = properties.getClockSkew();
        if (issuedAt.isAfter(now.plus(skew))) {
            return failure("issued in the future (" + issuedAt + ")");
        }
        if (issuedAt.isBefore(now.minus(properties.getMaxTokenAge()).minus(skew))) {
            return failure("issued too long ago (" + issuedAt + ")");
        }
        return OAuth2TokenValidatorResult.success();
    }

    private static OAuth2TokenValidatorResult failure(String description) {
        return OAuth2TokenValidatorResult.failure(
                new OAuth2Error(INVALID.getErrorCode(), description, null));
    }

    private static String describe(JwtValidationException e) {
        return e.getErrors().stream()
                .map(error -> error.getDescription() != null ? error.getDescription() : error.getErrorCode())
                .toList()
                .toString();
    }

    // The decoder reports "couldn't fetch the keys" as a plain JwtException wrapping Nimbus's
    // KeySourceException (RemoteKeySourceException for an HTTP failure). Walk the causes rather
    // than match the message, which is the library's to reword.
    private static boolean causedByKeySource(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof KeySourceException) {
                return true;
            }
        }
        return false;
    }

    // Google sends booleans; Apple has sent both booleans and the strings "true"/"false".
    private static boolean truthy(Object claim) {
        return claim instanceof Boolean b ? b : claim != null && "true".equalsIgnoreCase(claim.toString());
    }
}
