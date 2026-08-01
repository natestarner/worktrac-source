package com.worktrac.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

// Shared-secret gate for the public Event Grid delivery-report webhook (see
// emaildelivery.EmailDeliveryWebhookController) -- that endpoint has to be permitAll (Event Grid
// is a server-to-server caller with no JWT), so this query-param key is the only thing standing
// between it and the open internet. Set per-environment in the deploy repo, the same way
// ACS_EMAIL_CONNECTION_STRING is -- never hardcoded here.
@Component
@ConfigurationProperties(prefix = "app.email-delivery-webhook")
public class EmailDeliveryWebhookProperties {

    private String key;

    public String getKey() {
        return key;
    }

    public void setKey(String key) {
        this.key = key;
    }
}
