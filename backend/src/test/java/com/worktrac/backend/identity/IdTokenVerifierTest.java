package com.worktrac.backend.identity;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.PlainHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import com.worktrac.backend.config.EmailProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Every check {@link IdTokenVerifier} promises, each proved by a token that fails ONLY that check.
 *
 * <p>The keys are served by a real HTTP server on localhost, so the production decoder path runs
 * end to end: JWKS fetch, caching, re-fetch on an unknown key id, and the "provider is down" case.
 * Nothing here talks to Apple or Google.
 *
 * <p>The clock is fixed in 2030 on purpose. Every token below is valid only by that clock, so a
 * passing test also proves the injected {@link Clock} -- not the machine's -- decides expiry
 * (backend-core.md, "Time").
 */
@DisplayName("verifying Apple and Google ID tokens")
class IdTokenVerifierTest {

    private static final Instant NOW = Instant.parse("2030-03-01T12:00:00Z");
    private static final String CLIENT_ID = "com.huddle.app.test";
    private static final String GOOGLE_ISSUER = "https://accounts.google.com";
    private static final String APPLE_ISSUER = "https://appleid.apple.com";
    private static final String RAW_NONCE = "a-raw-nonce-of-plenty-length-1234";

    private HttpServer server;
    private final AtomicReference<String> jwks = new AtomicReference<>();
    private final AtomicInteger jwksStatus = new AtomicInteger(200);
    private final AtomicInteger jwksFetches = new AtomicInteger();
    private RSAKey googleKey;
    private RSAKey appleKey;
    private SocialSignInProperties properties;
    private IdTokenVerifier verifier;

    @BeforeEach
    void startKeyServer() throws Exception {
        googleKey = new RSAKeyGenerator(2048).keyID("google-1").generate();
        appleKey = new RSAKeyGenerator(2048).keyID("apple-1").generate();
        serveKeys(googleKey, appleKey);

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/keys", exchange -> {
            jwksFetches.incrementAndGet();
            byte[] body = jwks.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(jwksStatus.get(), body.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(body);
            }
        });
        server.start();

        properties = new SocialSignInProperties();
        properties.setEnabled(true);
        String jwksUri = "http://127.0.0.1:" + server.getAddress().getPort() + "/keys";
        properties.getGoogle().setJwksUri(jwksUri);
        properties.getGoogle().setClientIds(List.of(CLIENT_ID, "web-client-id"));
        properties.getApple().setJwksUri(jwksUri);
        properties.getApple().setClientIds(List.of(CLIENT_ID));
        verifier = new IdTokenVerifier(properties, Clock.fixed(NOW, ZoneOffset.UTC), Optional.empty());
    }

    @AfterEach
    void stopKeyServer() {
        server.stop(0);
    }

    private void serveKeys(RSAKey... keys) {
        jwks.set(new JWKSet(Arrays.stream(keys).map(RSAKey::toPublicJWK).map(k -> (com.nimbusds.jose.jwk.JWK) k).toList())
                .toString());
    }

    // ── token construction ─────────────────────────────────────────────────────────────────────

    private JWTClaimsSet.Builder googleClaims() {
        return new JWTClaimsSet.Builder()
                .issuer(GOOGLE_ISSUER)
                .subject("google-subject-1")
                .audience(CLIENT_ID)
                .issueTime(Date.from(NOW.minusSeconds(5)))
                .expirationTime(Date.from(NOW.plusSeconds(3600)))
                .claim("email", "Nate@Example.com")
                .claim("email_verified", true)
                .claim("nonce", IdTokenVerifier.sha256Hex(RAW_NONCE));
    }

    private String sign(RSAKey key, JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).type(JOSEObjectType.JWT).build(),
                claims);
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }

    private String google(Consumer<JWTClaimsSet.Builder> tweak) throws Exception {
        JWTClaimsSet.Builder claims = googleClaims();
        tweak.accept(claims);
        return sign(googleKey, claims.build());
    }

    private void assertRefused(String token) {
        assertThatThrownBy(() -> verifier.verify(IdentityProvider.GOOGLE, token, RAW_NONCE))
                .isInstanceOf(InvalidIdTokenException.class);
    }

    // ── what a good token proves ───────────────────────────────────────────────────────────────

    @Test
    void aGoodGoogleTokenYieldsItsSubjectAndALowerCasedVerifiedEmail() throws Exception {
        VerifiedIdentity identity = verifier.verify(IdentityProvider.GOOGLE, google(c -> { }), RAW_NONCE);

        assertThat(identity.provider()).isEqualTo(IdentityProvider.GOOGLE);
        assertThat(identity.subject()).isEqualTo("google-subject-1");
        assertThat(identity.email()).isEqualTo("nate@example.com");
        assertThat(identity.emailVerified()).isTrue();
        assertThat(identity.privateRelay()).isFalse();
    }

    @Test
    void googlesBareIssuerSpellingIsAcceptedToo() throws Exception {
        assertThat(verifier.verify(IdentityProvider.GOOGLE,
                google(c -> c.issuer("accounts.google.com")), RAW_NONCE).subject()).isEqualTo("google-subject-1");
    }

    @Test
    void anyOfThisEnvironmentsClientIdsIsAnAcceptableAudience() throws Exception {
        assertThat(verifier.verify(IdentityProvider.GOOGLE,
                google(c -> c.audience("web-client-id")), RAW_NONCE)).isNotNull();
    }

    // Apple has sent these as strings as well as booleans.
    @Test
    void appleStringBooleansAndHideMyEmailAreRead() throws Exception {
        String token = sign(appleKey, new JWTClaimsSet.Builder()
                .issuer(APPLE_ISSUER)
                .subject("001234.abcd.0042")
                .audience(CLIENT_ID)
                .issueTime(Date.from(NOW.minusSeconds(5)))
                .expirationTime(Date.from(NOW.plusSeconds(600)))
                .claim("email", "xyz123@privaterelay.appleid.com")
                .claim("email_verified", "true")
                .claim("is_private_email", "true")
                .claim("nonce", IdTokenVerifier.sha256Hex(RAW_NONCE))
                .build());

        VerifiedIdentity identity = verifier.verify(IdentityProvider.APPLE, token, RAW_NONCE);

        assertThat(identity.emailVerified()).isTrue();
        assertThat(identity.privateRelay()).isTrue();
        assertThat(identity.email()).isEqualTo("xyz123@privaterelay.appleid.com");
    }

    @Test
    void anUnverifiedEmailIsReportedAsUnverifiedNotRefused() throws Exception {
        // Refusing is the caller's decision (sign-UP needs a verified email; a linked sign-in does
        // not read the email at all) -- the verifier only reports.
        VerifiedIdentity identity = verifier.verify(IdentityProvider.GOOGLE,
                google(c -> c.claim("email_verified", false)), RAW_NONCE);
        assertThat(identity.emailVerified()).isFalse();
    }

    // ── each check, failed on its own ──────────────────────────────────────────────────────────

    @Nested
    @DisplayName("refuses")
    class Refuses {

        @Test
        void aTokenSignedByAnybodyElsesKeyEvenUnderTheRightKeyId() throws Exception {
            RSAKey impostor = new RSAKeyGenerator(2048).keyID("google-1").generate();
            assertRefused(sign(impostor, googleClaims().build()));
        }

        @Test
        void aTokenForAnotherApp() throws Exception {
            assertRefused(google(c -> c.audience("someone-elses-client-id")));
        }

        // The environment split: lower's client ids are not production's, so a token minted for
        // lower's app is worthless against production even though Google signed it.
        @Test
        void aTokenForTheOtherEnvironment() throws Exception {
            assertRefused(google(c -> c.audience("com.huddle.app.lower")));
        }

        @Test
        void aTokenFromAnotherIssuer() throws Exception {
            assertRefused(google(c -> c.issuer("https://evil.example.com")));
        }

        // A Google-signed token presented as Apple's: the right signature, the wrong provider.
        @Test
        void aGoogleTokenPresentedAsApple() throws Exception {
            String token = google(c -> { });
            assertThatThrownBy(() -> verifier.verify(IdentityProvider.APPLE, token, RAW_NONCE))
                    .isInstanceOf(InvalidIdTokenException.class);
        }

        @Test
        void anExpiredToken() throws Exception {
            assertRefused(google(c -> c
                    .issueTime(Date.from(NOW.minusSeconds(400)))
                    .expirationTime(Date.from(NOW.minus(Duration.ofMinutes(5))))));
        }

        @Test
        void aTokenWithNoExpiry() throws Exception {
            assertRefused(google(c -> c.expirationTime(null)));
        }

        // Google's tokens live an hour; we accept them for ten minutes after issue, so a token
        // lifted from somewhere goes stale fast even while Google would still call it valid.
        @Test
        void aTokenIssuedLongerAgoThanTheMaximumAgeEvenIfNotExpired() throws Exception {
            assertRefused(google(c -> c.issueTime(Date.from(NOW.minus(Duration.ofMinutes(15))))));
        }

        @Test
        void aTokenIssuedInTheFuture() throws Exception {
            assertRefused(google(c -> c.issueTime(Date.from(NOW.plus(Duration.ofMinutes(5))))));
        }

        @Test
        void aTokenWithNoIssueTime() throws Exception {
            assertRefused(google(c -> c.issueTime(null)));
        }

        @Test
        void aTokenWithNoSubject() throws Exception {
            assertRefused(google(c -> c.subject(null)));
        }

        @Test
        void aTokenBoundToADifferentNonce() throws Exception {
            assertRefused(google(c -> c.claim("nonce", IdTokenVerifier.sha256Hex("some-other-raw-nonce-xx"))));
        }

        @Test
        void aTokenWithNoNonce() throws Exception {
            assertRefused(google(c -> c.claim("nonce", null)));
        }

        // The client must give the provider the HASH. A token carrying the raw value means the
        // raw value travelled somewhere it should not have, and it proves nothing.
        @Test
        void aTokenCarryingTheRawNonceInsteadOfItsHash() throws Exception {
            assertRefused(google(c -> c.claim("nonce", RAW_NONCE)));
        }

        @Test
        void aRequestWithNoRawNonce() throws Exception {
            String token = google(c -> { });
            assertThatThrownBy(() -> verifier.verify(IdentityProvider.GOOGLE, token, " "))
                    .isInstanceOf(InvalidIdTokenException.class);
        }

        // alg: none -- the classic "unsigned token" attack.
        @Test
        void anUnsignedToken() {
            String token = new PlainJWT(new PlainHeader(), googleClaims().build()).serialize();
            assertRefused(token);
        }

        // HS256 signed with the provider's PUBLIC key as the HMAC secret -- the classic algorithm
        // confusion attack against verifiers that let the token choose its algorithm.
        @Test
        void anHmacTokenKeyedWithTheProvidersPublicKey() throws Exception {
            byte[] publicKeyBytes = googleKey.toPublicJWK().toRSAPublicKey().getEncoded();
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).keyID("google-1").build(),
                    googleClaims().build());
            jwt.sign(new MACSigner(Arrays.copyOf(publicKeyBytes, Math.max(32, publicKeyBytes.length))));
            assertRefused(jwt.serialize());
        }

        @Test
        void garbage() {
            assertRefused("not.a.jwt");
            assertRefused("eyJhbGciOiJSUzI1NiJ9.e30.bad");
        }

        @Test
        void anEmptyToken() {
            assertRefused(" ");
        }
    }

    // ── keys rotate, and providers have bad days ───────────────────────────────────────────────

    // Providers rotate signing keys. A token naming a key we have not seen must make us re-fetch
    // the key set rather than refuse a perfectly good sign-in until some cache expires.
    @Test
    void aRotatedKeyIsPickedUpByRefetchingTheKeySet() throws Exception {
        assertThat(verifier.verify(IdentityProvider.GOOGLE, google(c -> { }), RAW_NONCE)).isNotNull();
        int fetchesBefore = jwksFetches.get();

        RSAKey rotated = new RSAKeyGenerator(2048).keyID("google-2").generate();
        serveKeys(googleKey, appleKey, rotated);

        VerifiedIdentity identity = verifier.verify(IdentityProvider.GOOGLE, sign(rotated, googleClaims().build()), RAW_NONCE);

        assertThat(identity.subject()).isEqualTo("google-subject-1");
        assertThat(jwksFetches.get()).isGreaterThan(fetchesBefore);
    }

    @Test
    void theKeySetIsCachedRatherThanFetchedPerSignIn() throws Exception {
        verifier.verify(IdentityProvider.GOOGLE, google(c -> { }), RAW_NONCE);
        int afterFirst = jwksFetches.get();
        for (int i = 0; i < 5; i++) {
            verifier.verify(IdentityProvider.GOOGLE, google(c -> { }), RAW_NONCE);
        }
        assertThat(jwksFetches.get()).isEqualTo(afterFirst);
    }

    // "Google is down" must read as "try again", never as "your sign-in was bad".
    @Test
    void anUnreachableKeyServerIsReportedAsUnreachableNotAsABadToken() throws Exception {
        jwksStatus.set(503);
        String token = google(c -> { });
        assertThatThrownBy(() -> verifier.verify(IdentityProvider.GOOGLE, token, RAW_NONCE))
                .isInstanceOf(ProviderUnreachableException.class);
    }

    @Test
    void aKeyServerThatIsNotListeningIsUnreachableToo() throws Exception {
        String token = google(c -> { });
        server.stop(0);
        assertThatThrownBy(() -> verifier.verify(IdentityProvider.GOOGLE, token, RAW_NONCE))
                .isInstanceOf(ProviderUnreachableException.class);
    }

    // ── availability: what decides whether a provider exists here at all ───────────────────────

    @Nested
    @DisplayName("availability")
    class Availability {

        @Test
        void nothingIsAvailableWhileTheFeatureIsSwitchedOff() {
            properties.setEnabled(false);
            assertThat(verifier.isAvailable(IdentityProvider.GOOGLE)).isFalse();
            assertThat(verifier.isAvailable(IdentityProvider.APPLE)).isFalse();
        }

        @Test
        void aProviderWithNoClientIdsIsNotAvailable() {
            properties.getApple().setClientIds(List.of());
            assertThat(verifier.isAvailable(IdentityProvider.APPLE)).isFalse();
            assertThat(verifier.isAvailable(IdentityProvider.GOOGLE)).isTrue();
        }

        // An empty env var binds as [""]. An empty-string client id must never be something a
        // token could match, so blanks are dropped and the provider counts as unconfigured.
        @Test
        void blankClientIdsFromAnEmptyEnvVarDoNotCount() {
            properties.getApple().setClientIds(new ArrayList<>(List.of("", "  ")));
            assertThat(verifier.isAvailable(IdentityProvider.APPLE)).isFalse();
        }

        @Test
        void anUnavailableProviderIsNeverVerified() throws Exception {
            properties.getApple().setClientIds(List.of());
            String token = google(c -> { });
            assertThatThrownBy(() -> verifier.verify(IdentityProvider.APPLE, token, RAW_NONCE))
                    .isInstanceOf(IllegalStateException.class);
        }

        // ⚠️ Production has no TestIdentityTokens bean (it is @Profile local/lower), so the test
        // provider must not exist there however the flags are set.
        @Test
        void theTestProviderDoesNotExistWithoutItsBean() {
            assertThat(verifier.isAvailable(IdentityProvider.TEST)).isFalse();
        }

        @Test
        void theTestProviderNeedsItsKeyEvenWhereTheBeanExists() {
            EmailProperties noKey = new EmailProperties();
            IdTokenVerifier withBean = new IdTokenVerifier(properties, Clock.fixed(NOW, ZoneOffset.UTC),
                    Optional.of(new TestIdentityTokens(noKey)));
            assertThat(withBean.isAvailable(IdentityProvider.TEST)).isFalse();
        }

        // Pins the first of TestIdentityTokens' two gates. Widening this list -- adding
        // "production", or removing the annotation -- would put a provider that mints tokens for
        // any email into production behind nothing but a header.
        @Test
        void theTestProviderBeanIsConfinedToLocalAndLower() {
            Profile profile = TestIdentityTokens.class.getAnnotation(Profile.class);
            assertThat(profile).isNotNull();
            assertThat(profile.value()).containsExactlyInAnyOrder("local", "lower");
        }
    }

    // ── the test provider itself ───────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("the test provider")
    class TestProvider {

        private IdTokenVerifier withTestProvider;
        private TestIdentityTokens tokens;

        @BeforeEach
        void setUp() {
            EmailProperties email = new EmailProperties();
            email.setTestSupportKey("a-test-support-key");
            tokens = new TestIdentityTokens(email);
            withTestProvider = new IdTokenVerifier(properties, Clock.fixed(NOW, ZoneOffset.UTC), Optional.of(tokens));
        }

        @Test
        void verifiesItsOwnTokensThroughTheSameChecks() {
            String token = tokens.mint("t-1", "a@example.com", true, RAW_NONCE, null,
                    NOW.minusSeconds(1), NOW.plusSeconds(600));
            assertThat(withTestProvider.verify(IdentityProvider.TEST, token, RAW_NONCE).subject()).isEqualTo("t-1");
        }

        @Test
        void refusesItsOwnTokenWithAForeignAudienceOrAStaleIssueTime() {
            String foreign = tokens.mint("t-1", "a@example.com", true, RAW_NONCE, "not-the-test-client",
                    NOW.minusSeconds(1), NOW.plusSeconds(600));
            String stale = tokens.mint("t-1", "a@example.com", true, RAW_NONCE, null,
                    NOW.minus(Duration.ofMinutes(30)), NOW.plusSeconds(600));
            assertThatThrownBy(() -> withTestProvider.verify(IdentityProvider.TEST, foreign, RAW_NONCE))
                    .isInstanceOf(InvalidIdTokenException.class);
            assertThatThrownBy(() -> withTestProvider.verify(IdentityProvider.TEST, stale, RAW_NONCE))
                    .isInstanceOf(InvalidIdTokenException.class);
        }

        // A test token is never a Google token, whatever it claims.
        @Test
        void itsTokensAreNotAcceptedAsGoogle() {
            String token = tokens.mint("t-1", "a@example.com", true, RAW_NONCE, CLIENT_ID,
                    NOW.minusSeconds(1), NOW.plusSeconds(600));
            assertThatThrownBy(() -> withTestProvider.verify(IdentityProvider.GOOGLE, token, RAW_NONCE))
                    .isInstanceOf(InvalidIdTokenException.class);
        }

        // A token keyed from a different test-support key (another environment's) is refused.
        @Test
        void aTokenFromAnotherEnvironmentsTestKeyIsRefused() {
            EmailProperties other = new EmailProperties();
            other.setTestSupportKey("a-different-key");
            String token = new TestIdentityTokens(other).mint("t-1", "a@example.com", true, RAW_NONCE, null,
                    NOW.minusSeconds(1), NOW.plusSeconds(600));
            assertThatThrownBy(() -> withTestProvider.verify(IdentityProvider.TEST, token, RAW_NONCE))
                    .isInstanceOf(InvalidIdTokenException.class);
        }
    }

    // ── re-confirming an existing login ────────────────────────────────────────────────────────

    // Switching new sign-ins off must never strand a login with no password: it can still prove
    // itself (to delete the account, or set a password) wherever the provider is configured.
    @Test
    void reconfirmationStillWorksWithNewSignInsSwitchedOff() throws Exception {
        properties.setEnabled(false);
        assertThat(verifier.isAvailable(IdentityProvider.GOOGLE)).isFalse();
        assertThat(verifier.isConfigured(IdentityProvider.GOOGLE)).isTrue();

        assertThat(verifier.verifyForReconfirmation(IdentityProvider.GOOGLE, google(c -> { }), RAW_NONCE).subject())
                .isEqualTo("google-subject-1");
    }

    @Test
    void reconfirmationRunsEveryTokenCheck() throws Exception {
        String foreign = google(c -> c.audience("someone-elses-client-id"));
        assertThatThrownBy(() -> verifier.verifyForReconfirmation(IdentityProvider.GOOGLE, foreign, RAW_NONCE))
                .isInstanceOf(InvalidIdTokenException.class);
    }

    @Test
    void theVerifiedIdentityCarriesWhichOfOurClientIdsTheTokenWasFor() throws Exception {
        assertThat(verifier.verify(IdentityProvider.GOOGLE, google(c -> c.audience(List.of("x", "web-client-id"))), RAW_NONCE)
                .clientId()).isEqualTo("web-client-id");
    }

    // ── Apple's server-to-server notifications ─────────────────────────────────────────────────

    private String appleNotification(java.util.function.Consumer<JWTClaimsSet.Builder> tweak) throws Exception {
        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .issuer(APPLE_ISSUER)
                .audience(CLIENT_ID)
                .issueTime(Date.from(NOW.minusSeconds(30)))
                .jwtID("n-1")
                .claim("events", "{\"type\":\"consent-revoked\",\"sub\":\"001234.abcd.0042\",\"event_time\":1}");
        tweak.accept(claims);
        return sign(appleKey, claims.build());
    }

    @Test
    void aGenuineAppleNotificationIsAcceptedWithoutANonceOrExpiry() throws Exception {
        assertThat(verifier.verifyAppleNotification(appleNotification(c -> { })).getClaimAsString("events"))
                .contains("consent-revoked");
    }

    @Test
    void anAppleNotificationForAnotherAppIsRefused() throws Exception {
        String other = appleNotification(c -> c.audience("someone.elses.app"));
        assertThatThrownBy(() -> verifier.verifyAppleNotification(other)).isInstanceOf(InvalidIdTokenException.class);
    }

    @Test
    void anAppleNotificationNotSignedByAppleIsRefused() throws Exception {
        RSAKey impostor = new RSAKeyGenerator(2048).keyID("apple-1").generate();
        JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer(APPLE_ISSUER).audience(CLIENT_ID)
                .issueTime(Date.from(NOW)).claim("events", "{}").build();
        String forged = sign(impostor, claims);
        assertThatThrownBy(() -> verifier.verifyAppleNotification(forged)).isInstanceOf(InvalidIdTokenException.class);
    }

    // A captured notification replayed much later must not act again.
    @Test
    void aStaleAppleNotificationIsRefused() throws Exception {
        String old = appleNotification(c -> c.issueTime(Date.from(NOW.minus(Duration.ofDays(10)))));
        assertThatThrownBy(() -> verifier.verifyAppleNotification(old)).isInstanceOf(InvalidIdTokenException.class);
    }

    @Test
    void aGoogleSignedPayloadIsNotAnAppleNotification() throws Exception {
        String google = sign(googleKey, new JWTClaimsSet.Builder().issuer(GOOGLE_ISSUER).audience(CLIENT_ID)
                .issueTime(Date.from(NOW)).claim("events", "{}").build());
        assertThatThrownBy(() -> verifier.verifyAppleNotification(google)).isInstanceOf(InvalidIdTokenException.class);
    }

    @Test
    void theNonceHashIsLowerCaseHexSha256() {
        // Fixed vector, so the client and server can never silently disagree on the encoding.
        assertThat(IdTokenVerifier.sha256Hex("abc"))
                .isEqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
