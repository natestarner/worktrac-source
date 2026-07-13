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
}
