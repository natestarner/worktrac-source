package com.worktrac.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.email")
public class EmailProperties {

    private String connectionString;
    private String senderAddress;
    private int codeExpirationMinutes = 15;

    // Base URL for the "Open Huddle" link in the registration-success email, e.g.
    // https://huddle.fitness/app/log. Differs per environment the same way
    // connectionString/senderAddress do, so it's sourced from an env var with no
    // production default -- only application-local.yml gives it a fallback.
    private String appUrl;

    // Only ever set in local/lower -- gates the test-support endpoint in addition to its
    // @Profile restriction (see TestSupportController). Left null in production, where the
    // endpoint's controller bean doesn't exist at all regardless of this value.
    private String testSupportKey;

    // Only ever set in local/lower -- a regex EmailService checks every recipient against
    // before actually calling Azure Communication Services. A full match skips the real send
    // entirely (see EmailService.isE2eNoopRecipient), so the e2e suite's ~60 "just need an
    // account" registrations stop generating real ACS traffic (and real bounces before the
    // huddle+e2e-... mailbox switch). Left empty in production -- same two-layer-defense
    // pattern as testSupportKey, not relied on alone: even if this were somehow non-empty there,
    // a genuine user would still need to own huddle@starner.co to ever match it.
    private String e2eNoopRecipientPattern;

    public String getConnectionString() {
        return connectionString;
    }

    public void setConnectionString(String connectionString) {
        this.connectionString = connectionString;
    }

    public String getSenderAddress() {
        return senderAddress;
    }

    public void setSenderAddress(String senderAddress) {
        this.senderAddress = senderAddress;
    }

    public int getCodeExpirationMinutes() {
        return codeExpirationMinutes;
    }

    public void setCodeExpirationMinutes(int codeExpirationMinutes) {
        this.codeExpirationMinutes = codeExpirationMinutes;
    }

    public String getTestSupportKey() {
        return testSupportKey;
    }

    public void setTestSupportKey(String testSupportKey) {
        this.testSupportKey = testSupportKey;
    }

    public String getAppUrl() {
        return appUrl;
    }

    public void setAppUrl(String appUrl) {
        this.appUrl = appUrl;
    }

    public String getE2eNoopRecipientPattern() {
        return e2eNoopRecipientPattern;
    }

    public void setE2eNoopRecipientPattern(String e2eNoopRecipientPattern) {
        this.e2eNoopRecipientPattern = e2eNoopRecipientPattern;
    }
}
