package com.worktrac.backend.identity;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Revoking a person's Apple sign-in on account deletion, against a local stand-in for Apple's
 * {@code /auth/token} and {@code /auth/revoke}. Nothing here talks to Apple.
 */
@DisplayName("revoking Apple sign-in on account deletion")
class AppleTokenRevokerTest {

    private static final Instant NOW = Instant.parse("2030-03-01T12:00:00Z");
    private static final String SUBJECT = "001234.abcd.0042";

    private HttpServer server;
    private final List<Map<String, String>> tokenCalls = new CopyOnWriteArrayList<>();
    private final List<Map<String, String>> revokeCalls = new CopyOnWriteArrayList<>();
    private final AtomicInteger tokenStatus = new AtomicInteger(200);
    private final AtomicInteger revokeStatus = new AtomicInteger(200);
    private final AtomicReference<String> exchangedSubject = new AtomicReference<>(SUBJECT);
    private ECKey signingKey;
    private SocialSignInProperties properties;
    private AppleTokenRevoker revoker;

    @BeforeEach
    void setUp() throws Exception {
        signingKey = new ECKeyGenerator(Curve.P_256).keyID("KEY123").generate();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/auth/token", exchange -> {
            tokenCalls.add(form(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            String body = tokenStatus.get() == 200
                    ? "{\"access_token\":\"at-1\",\"refresh_token\":\"rt-1\",\"id_token\":\"" + appleIdToken(exchangedSubject.get()) + "\"}"
                    : "{\"error\":\"invalid_grant\"}";
            respond(exchange, tokenStatus.get(), body);
        });
        server.createContext("/auth/revoke", exchange -> {
            revokeCalls.add(form(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            respond(exchange, revokeStatus.get(), "");
        });
        server.start();

        properties = new SocialSignInProperties();
        properties.getAppleRevocation().setTeamId("R73TEAM");
        properties.getAppleRevocation().setKeyId("KEY123");
        properties.getAppleRevocation().setPrivateKey(pem(signingKey));
        properties.getAppleRevocation().setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        revoker = new AppleTokenRevoker(properties, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void exchangesTheCodeAsTheSameClientThenRevokesTheRefreshToken() {
        revoker.revoke("com.huddle.app", "code-1", SUBJECT, null);

        assertThat(tokenCalls).singleElement().satisfies(call -> {
            assertThat(call).containsEntry("client_id", "com.huddle.app")
                    .containsEntry("code", "code-1")
                    .containsEntry("grant_type", "authorization_code")
                    .doesNotContainKey("redirect_uri");
        });
        assertThat(revokeCalls).singleElement().satisfies(call -> {
            assertThat(call).containsEntry("client_id", "com.huddle.app")
                    .containsEntry("token", "rt-1")
                    .containsEntry("token_type_hint", "refresh_token");
        });
    }

    @Test
    void aWebCodeSendsItsRedirectUriBack() {
        revoker.revoke("com.huddle.web", "code-1", SUBJECT, "https://app.huddle.fitness/apple-callback");
        assertThat(tokenCalls.get(0)).containsEntry("redirect_uri", "https://app.huddle.fitness/apple-callback");
    }

    // The client secret is what proves to Apple the call is ours: ES256 under our .p8, our team as
    // issuer, the client id as subject, Apple as audience, short-lived.
    @Test
    void theClientSecretIsAShortLivedEs256JwtFromOurTeam() throws Exception {
        SignedJWT secret = SignedJWT.parse(revoker.clientSecret("com.huddle.app"));

        assertThat(secret.verify(new ECDSAVerifier(signingKey.toECPublicKey()))).isTrue();
        assertThat(secret.getHeader().getAlgorithm()).isEqualTo(JWSAlgorithm.ES256);
        assertThat(secret.getHeader().getKeyID()).isEqualTo("KEY123");
        JWTClaimsSet claims = secret.getJWTClaimsSet();
        assertThat(claims.getIssuer()).isEqualTo("R73TEAM");
        assertThat(claims.getSubject()).isEqualTo("com.huddle.app");
        assertThat(claims.getAudience()).containsExactly("https://appleid.apple.com");
        assertThat(claims.getExpirationTime().toInstant()).isBeforeOrEqualTo(NOW.plusSeconds(300));
    }

    // ⚠️ The code must belong to the person whose login is being deleted. A caller pairing their
    // own valid ID token with somebody else's code must not get that somebody's Apple sign-in revoked.
    @Test
    void aCodeForADifferentAppleAccountIsRefusedAndNothingIsRevoked() {
        exchangedSubject.set("someone-else");

        assertThatThrownBy(() -> revoker.revoke("com.huddle.app", "code-1", SUBJECT, null))
                .isInstanceOf(AppleTokenRevoker.AppleRevocationException.class);
        assertThat(revokeCalls).isEmpty();
    }

    @Test
    void aRefusedExchangeFailsWithoutRevoking() {
        tokenStatus.set(400);
        assertThatThrownBy(() -> revoker.revoke("com.huddle.app", "used-code", SUBJECT, null))
                .isInstanceOf(AppleTokenRevoker.AppleRevocationException.class)
                .hasMessageContaining("invalid_grant");
        assertThat(revokeCalls).isEmpty();
    }

    @Test
    void aFailedRevokeIsAFailure() {
        revokeStatus.set(500);
        assertThatThrownBy(() -> revoker.revoke("com.huddle.app", "code-1", SUBJECT, null))
                .isInstanceOf(AppleTokenRevoker.AppleRevocationException.class);
    }

    @Test
    void anUnreachableAppleIsAFailure() {
        server.stop(0);
        assertThatThrownBy(() -> revoker.revoke("com.huddle.app", "code-1", SUBJECT, null))
                .isInstanceOf(AppleTokenRevoker.AppleRevocationException.class);
    }

    // An env var or secret store often turns the .p8's line breaks into literal "\n".
    @Test
    void readsAKeyWhoseLineBreaksBecameEscapes() {
        properties.getAppleRevocation().setPrivateKey(pem(signingKey).replace("\n", "\\n"));
        revoker.revoke("com.huddle.app", "code-1", SUBJECT, null);
        assertThat(revokeCalls).hasSize(1);
    }

    @Test
    void anUnreadableKeyFailsWithoutEchoingIt() {
        properties.getAppleRevocation().setPrivateKey("-----BEGIN PRIVATE KEY-----\nnot-a-key-SECRETVALUE\n-----END PRIVATE KEY-----");
        assertThatThrownBy(() -> revoker.revoke("com.huddle.app", "code-1", SUBJECT, null))
                .isInstanceOf(AppleTokenRevoker.AppleRevocationException.class)
                .satisfies(e -> assertThat(e.getMessage()).doesNotContain("SECRETVALUE"));
    }

    @Test
    void isNotConfiguredWithoutTeamKeyAndPrivateKey() {
        SocialSignInProperties empty = new SocialSignInProperties();
        assertThat(new AppleTokenRevoker(empty, Clock.systemUTC()).isConfigured()).isFalse();
        empty.getAppleRevocation().setTeamId("T");
        empty.getAppleRevocation().setKeyId("K");
        assertThat(new AppleTokenRevoker(empty, Clock.systemUTC()).isConfigured()).isFalse();
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────────────

    private static String pem(ECKey key) {
        try {
            String base64 = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.UTF_8))
                    .encodeToString(key.toECPrivateKey().getEncoded());
            return "-----BEGIN PRIVATE KEY-----\n" + base64 + "\n-----END PRIVATE KEY-----\n";
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // Only the subject is read from Apple's id_token in the exchange answer.
    private static String appleIdToken(String subject) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256),
                    new JWTClaimsSet.Builder().issuer("https://appleid.apple.com").subject(subject).build());
            jwt.sign(new MACSigner(new byte[32]));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static Map<String, String> form(String body) {
        return Arrays.stream(body.split("&"))
                .map(pair -> pair.split("=", 2))
                .collect(Collectors.toMap(
                        kv -> URLDecoder.decode(kv[0], StandardCharsets.UTF_8),
                        kv -> kv.length > 1 ? URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : ""));
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        }
        exchange.close();
    }
}
