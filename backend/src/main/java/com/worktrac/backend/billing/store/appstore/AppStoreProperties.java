package com.worktrac.backend.billing.store.appstore;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Apple In-App Purchase configuration, per environment. Every value empty by default: an environment
 * without it answers 503 to the app and 401 to Apple rather than defaulting open -- the same posture as
 * {@code StripeProperties}. Set in the same places billing config lives (application.yml placeholders,
 * the deploy repo's env block, its secrets). See docs/in-app-purchase-plan.md, Phase 0.
 */
@Component
@ConfigurationProperties(prefix = "app.store.apple")
public class AppStoreProperties {

    /** {@code fitness.huddle.app} for Huddle, {@code fitness.huddle.app.lower} for Huddle Lower. */
    private String bundleId;

    /** The app's numeric Apple ID (Huddle: 6826555272). Required to verify PRODUCTION data. */
    private Long appAppleId;

    /** From App Store Connect, Users and Access, Integrations, In-App Purchase. */
    private String issuerId;

    private String keyId;

    /**
     * The In-App Purchase key's .p8 contents (PEM). A secret. An env var that cannot hold newlines may
     * carry them as the two characters {@code \n}; {@link #privateKeyPem()} restores them.
     */
    private String privateKey;

    /**
     * Prepended to every product id: {@code huddle.} for Huddle, {@code huddle.lower.} for Huddle Lower
     * (product ids must be unique per developer account, and the two apps are separate records).
     */
    private String productPrefix;

    public boolean isConfigured() {
        return notBlank(bundleId) && appAppleId != null && notBlank(issuerId) && notBlank(keyId)
                && notBlank(privateKey) && notBlank(productPrefix);
    }

    public String privateKeyPem() {
        return privateKey == null ? null : privateKey.replace("\\n", "\n").trim();
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    public String getBundleId() {
        return bundleId;
    }

    public void setBundleId(String bundleId) {
        this.bundleId = bundleId;
    }

    public Long getAppAppleId() {
        return appAppleId;
    }

    public void setAppAppleId(Long appAppleId) {
        this.appAppleId = appAppleId;
    }

    public String getIssuerId() {
        return issuerId;
    }

    public void setIssuerId(String issuerId) {
        this.issuerId = issuerId;
    }

    public String getKeyId() {
        return keyId;
    }

    public void setKeyId(String keyId) {
        this.keyId = keyId;
    }

    public String getPrivateKey() {
        return privateKey;
    }

    public void setPrivateKey(String privateKey) {
        this.privateKey = privateKey;
    }

    public String getProductPrefix() {
        return productPrefix;
    }

    public void setProductPrefix(String productPrefix) {
        this.productPrefix = productPrefix;
    }
}
