package com.worktrac.backend.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Sign in with Apple / Google. See docs/architecture/social-sign-in.md.
 *
 * <p><b>Off unless {@code enabled} is true AND the provider has at least one client id.</b> Both
 * come from the Container App's env vars in the deploy repo. Each environment has its OWN client
 * ids (lower's web origin and TestFlight bundle differ from production's), and a token is only
 * accepted when its {@code aud} is one of THIS environment's ids -- which is what stops a token
 * minted for lower's app from signing anybody in to production.
 *
 * <p>The issuers and JWKS URLs have the providers' published values as defaults and are
 * configurable only so tests can point a provider at a local key server. Never set them in a
 * deployed environment.
 */
@Component
@ConfigurationProperties(prefix = "app.social-sign-in")
public class SocialSignInProperties {

    private boolean enabled = false;

    /**
     * How old an ID token may be when it reaches us, by its {@code iat}. Apple's live for 10
     * minutes and Google's for an hour; a sign-in sends its token within seconds, and the extra
     * margin covers the sign-up name step. Short, because a leaked token is replayable until then.
     */
    private Duration maxTokenAge = Duration.ofMinutes(10);

    /** Tolerated difference between our clock and the provider's, either direction. */
    private Duration clockSkew = Duration.ofSeconds(60);

    private final Provider google = new Provider(
            List.of("https://accounts.google.com", "accounts.google.com"),
            "https://www.googleapis.com/oauth2/v3/certs");

    private final Provider apple = new Provider(
            List.of("https://appleid.apple.com"),
            "https://appleid.apple.com/auth/keys");

    /**
     * What Apple's token endpoints need, used ONLY to revoke a person's Apple sign-in when they
     * delete their account (App Store Review requires it). The private key is a SECRET (the .p8 from
     * the Apple Developer portal, as PEM text) and comes from a Container App secret, never from a
     * file in this repo. Team id and key id are not secret.
     */
    private final AppleRevocation appleRevocation = new AppleRevocation();

    public AppleRevocation getAppleRevocation() {
        return appleRevocation;
    }

    public static class AppleRevocation {

        private String teamId = "";
        private String keyId = "";
        private String privateKey = "";
        // Configurable only so tests can point it at a local stub. Never set in an environment.
        private String baseUrl = "https://appleid.apple.com";
        private Duration timeout = Duration.ofSeconds(10);

        public boolean isConfigured() {
            return !teamId.isBlank() && !keyId.isBlank() && !privateKey.isBlank();
        }

        public String getTeamId() {
            return teamId;
        }

        public void setTeamId(String teamId) {
            this.teamId = teamId == null ? "" : teamId.trim();
        }

        public String getKeyId() {
            return keyId;
        }

        public void setKeyId(String keyId) {
            this.keyId = keyId == null ? "" : keyId.trim();
        }

        public String getPrivateKey() {
            return privateKey;
        }

        public void setPrivateKey(String privateKey) {
            this.privateKey = privateKey == null ? "" : privateKey;
        }

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        public Duration getTimeout() {
            return timeout;
        }

        public void setTimeout(Duration timeout) {
            this.timeout = timeout;
        }
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Duration getMaxTokenAge() {
        return maxTokenAge;
    }

    public void setMaxTokenAge(Duration maxTokenAge) {
        this.maxTokenAge = maxTokenAge;
    }

    public Duration getClockSkew() {
        return clockSkew;
    }

    public void setClockSkew(Duration clockSkew) {
        this.clockSkew = clockSkew;
    }

    public Provider getGoogle() {
        return google;
    }

    public Provider getApple() {
        return apple;
    }

    public Provider forProvider(IdentityProvider provider) {
        return switch (provider) {
            case APPLE -> apple;
            case GOOGLE -> google;
            // The test provider's settings are fixed in TestIdentityTokens, not configured.
            case TEST -> throw new IllegalArgumentException("The test provider is not configured here");
        };
    }

    public static class Provider {

        // Every OAuth client id of this environment's apps: the web client, the iOS bundle id
        // (Apple) or iOS client id (Google), and later Android. Comma-separated in the env var.
        private List<String> clientIds = new ArrayList<>();
        private List<String> issuers;
        private String jwksUri;

        Provider(List<String> issuers, String jwksUri) {
            this.issuers = new ArrayList<>(issuers);
            this.jwksUri = jwksUri;
        }

        public List<String> getClientIds() {
            return clientIds;
        }

        public void setClientIds(List<String> clientIds) {
            // Blank entries come from an empty env var ("") or a trailing comma. Dropping them
            // matters: an empty-string client id must never be something a token can match.
            this.clientIds = clientIds == null ? new ArrayList<>() : new ArrayList<>(clientIds.stream()
                    .map(String::trim)
                    .filter(id -> !id.isEmpty())
                    .toList());
        }

        public List<String> getIssuers() {
            return issuers;
        }

        public void setIssuers(List<String> issuers) {
            this.issuers = issuers;
        }

        public String getJwksUri() {
            return jwksUri;
        }

        public void setJwksUri(String jwksUri) {
            this.jwksUri = jwksUri;
        }

        public boolean isConfigured() {
            return !clientIds.isEmpty();
        }
    }
}
