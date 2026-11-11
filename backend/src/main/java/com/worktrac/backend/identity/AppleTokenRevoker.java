package com.worktrac.backend.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.text.ParseException;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Disconnects Huddle from somebody's Apple ID when they delete their account. App Store Review
 * requires this of every app that offers Sign in with Apple.
 *
 * <p><b>We never store an Apple token.</b> Revoking needs one, so the person re-confirms with Apple
 * as part of deleting, and that gives us a fresh one-time authorization code. Here it is exchanged
 * for a token (as the same client id it was issued to), and that token is revoked at once. Both
 * calls are to Apple, over TLS, with a short-lived client secret: an ES256 JWT signed with the
 * .p8 key from the Apple Developer portal.
 *
 * <p><b>The exchange must be for the SAME person who re-confirmed.</b> The code and the ID token
 * arrive in one request, but nothing binds them together until Apple's answer to the exchange: its
 * own {@code id_token} names the subject the code belonged to, and it has to match. Otherwise a
 * caller could pair their own valid ID token with somebody else's code.
 */
@Component
public class AppleTokenRevoker {

    private static final Logger log = LoggerFactory.getLogger(AppleTokenRevoker.class);

    private final SocialSignInProperties.AppleRevocation config;
    private final Clock clock;
    private final HttpClient http;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AppleTokenRevoker(SocialSignInProperties properties, Clock clock) {
        this.config = properties.getAppleRevocation();
        this.clock = clock;
        this.http = HttpClient.newBuilder().connectTimeout(config.getTimeout()).build();
    }

    public boolean isConfigured() {
        return config.isConfigured();
    }

    /**
     * @param clientId          the client id the code was issued to (the verified ID token's audience)
     * @param authorizationCode Apple's one-time code from the same re-confirmation
     * @param expectedSubject   the Apple subject linked to the login being deleted
     * @param redirectUri       for a code from the web flow, the redirect URI it was issued with
     *                          (Apple requires it back); null for a code from the iOS app
     * @throws AppleRevocationException on any failure; nothing has been revoked unless this returns
     */
    public void revoke(String clientId, String authorizationCode, String expectedSubject, String redirectUri) {
        if (!isConfigured()) {
            throw new IllegalStateException("Apple revocation is not configured");
        }
        String clientSecret = clientSecret(clientId);

        Map<String, String> exchange = new LinkedHashMap<>();
        exchange.put("client_id", clientId);
        exchange.put("client_secret", clientSecret);
        exchange.put("code", authorizationCode);
        exchange.put("grant_type", "authorization_code");
        if (redirectUri != null && !redirectUri.isBlank()) {
            exchange.put("redirect_uri", redirectUri);
        }
        JsonNode tokens = post("/auth/token", exchange);

        String exchangedSubject = subjectOf(tokens.path("id_token").asText(null));
        if (!expectedSubject.equals(exchangedSubject)) {
            throw new AppleRevocationException("The Apple code belongs to a different Apple account");
        }

        String refreshToken = tokens.path("refresh_token").asText("");
        boolean useRefresh = !refreshToken.isBlank();
        String token = useRefresh ? refreshToken : tokens.path("access_token").asText("");
        if (token.isBlank()) {
            throw new AppleRevocationException("Apple's token exchange returned no token to revoke");
        }

        Map<String, String> revoke = new LinkedHashMap<>();
        revoke.put("client_id", clientId);
        revoke.put("client_secret", clientSecret);
        revoke.put("token", token);
        revoke.put("token_type_hint", useRefresh ? "refresh_token" : "access_token");
        post("/auth/revoke", revoke);
        log.info("Revoked Apple sign-in for an Apple subject on account deletion");
    }

    // An ES256 JWT, valid for five minutes, that proves to Apple this request is from our team.
    String clientSecret(String clientId) {
        Instant now = clock.instant();
        try {
            SignedJWT jwt = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(config.getKeyId()).build(),
                    new JWTClaimsSet.Builder()
                            .issuer(config.getTeamId())
                            .issueTime(Date.from(now))
                            .expirationTime(Date.from(now.plusSeconds(300)))
                            .audience("https://appleid.apple.com")
                            .subject(clientId)
                            .build());
            jwt.sign(new ECDSASigner(privateKey()));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new AppleRevocationException("Could not sign the Apple client secret", e);
        }
    }

    private ECPrivateKey privateKey() {
        // The .p8 file's PEM text. Tolerates the header lines and the "\n" escapes an env var or
        // secret store may have turned the line breaks into.
        String base64 = config.getPrivateKey()
                .replace("\\n", "\n")
                .replaceAll("-----(BEGIN|END) PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        try {
            byte[] der = Base64.getDecoder().decode(base64);
            return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(der));
        } catch (IllegalArgumentException | GeneralSecurityException | ClassCastException e) {
            // Never include the key, or any part of it, in the message.
            throw new AppleRevocationException("The configured Apple private key could not be read", e);
        }
    }

    private JsonNode post(String path, Map<String, String> form) {
        String body = form.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        HttpRequest request = HttpRequest.newBuilder(URI.create(config.getBaseUrl() + path))
                .timeout(config.getTimeout())
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                // Apple's error body is a short code ("invalid_grant"), never a secret of ours.
                throw new AppleRevocationException("Apple " + path + " answered " + response.statusCode()
                        + ": " + abbreviate(response.body()));
            }
            String text = response.body();
            return text == null || text.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(text);
        } catch (IOException e) {
            throw new AppleRevocationException("Couldn't reach Apple " + path, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AppleRevocationException("Interrupted calling Apple " + path, e);
        }
    }

    // Apple's id_token from the exchange came straight from Apple over TLS in answer to our
    // authenticated call, so reading its subject without re-verifying the signature is sound here.
    private static String subjectOf(String idToken) {
        if (idToken == null || idToken.isBlank()) {
            throw new AppleRevocationException("Apple's token exchange returned no id_token");
        }
        try {
            return SignedJWT.parse(idToken).getJWTClaimsSet().getSubject();
        } catch (ParseException e) {
            throw new AppleRevocationException("Apple's id_token could not be read", e);
        }
    }

    private static String abbreviate(String text) {
        if (text == null) {
            return "";
        }
        return text.length() > 200 ? text.substring(0, 200) + "…" : text;
    }

    public static class AppleRevocationException extends RuntimeException {
        public AppleRevocationException(String message) {
            super(message);
        }

        public AppleRevocationException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
