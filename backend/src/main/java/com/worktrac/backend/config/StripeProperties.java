package com.worktrac.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

// Stripe wiring, set per-environment in the deploy repo's Container App env vars and NEVER
// hardcoded here -- the same rule ACS_EMAIL_CONNECTION_STRING and APP_JWT_SECRET follow.
//
// EVERY VALUE IS EMPTY BY DEFAULT, and that is a security property rather than laziness: an
// environment with no Stripe configuration rejects billing requests outright (see isConfigured)
// instead of defaulting open. Same posture as EmailDeliveryWebhookProperties and AdminProperties.
// Local development with no keys exported therefore degrades to "billing unavailable", which is the
// correct default for the worktrees that do not care about billing.
//
// Keys, price ids and the webhook secret all DIFFER between the Stripe sandbox and the live
// account, which is precisely why none of them can be constants.
//
// There is deliberately no api-version property: the stripe-java DEPENDENCY VERSION is the API
// pin. Each SDK release is generated against one Stripe API version and speaks it on every
// request, so a Dashboard account upgrade cannot change what this code sees. See StripeService.
@Component
@ConfigurationProperties(prefix = "app.stripe")
public class StripeProperties {

    // sk_test_... / sk_live_... -- a real credential in both modes. Never logged, never returned.
    private String secretKey;

    // pk_test_... / pk_live_... Designed to be public: it is handed to the browser so Stripe.js can
    // mount the embedded checkout. It is returned by the API rather than baked into config.json so
    // there is ONE source of Stripe configuration (backend env) instead of a second copy to keep in
    // sync across three frontend-env.json files.
    private String publishableKey;

    // whsec_... The only thing standing between the permitAll webhook route and the open internet.
    // Note the local value differs from the deployed one: `stripe listen` mints its own.
    private String webhookSecret;

    private String priceMonthly;
    private String priceYearly;

    // Where Stripe returns the browser after embedded checkout. Per-environment because it is an
    // absolute URL: app.dev.huddle.fitness in lower, app.huddle.fitness in production.
    private String returnUrl;

    // The single gate every billing entry point checks. A partially-configured environment counts
    // as unconfigured on purpose -- half a Stripe integration is worse than none, since it can take
    // a payment it cannot then reconcile.
    public boolean isConfigured() {
        return notBlank(secretKey) && notBlank(publishableKey) && notBlank(priceMonthly)
                && notBlank(priceYearly) && notBlank(returnUrl);
    }

    // Checked separately from isConfigured: the webhook must reject even when the rest of billing
    // is wired up, and it is the one piece that can be legitimately absent while checkout works
    // (a developer running without `stripe listen`).
    public boolean isWebhookConfigured() {
        return notBlank(webhookSecret);
    }

    private static boolean notBlank(String value) {
        return value != null && !value.isBlank();
    }

    public String getSecretKey() {
        return secretKey;
    }

    public void setSecretKey(String secretKey) {
        this.secretKey = secretKey;
    }

    public String getPublishableKey() {
        return publishableKey;
    }

    public void setPublishableKey(String publishableKey) {
        this.publishableKey = publishableKey;
    }

    public String getWebhookSecret() {
        return webhookSecret;
    }

    public void setWebhookSecret(String webhookSecret) {
        this.webhookSecret = webhookSecret;
    }

    public String getPriceMonthly() {
        return priceMonthly;
    }

    public void setPriceMonthly(String priceMonthly) {
        this.priceMonthly = priceMonthly;
    }

    public String getPriceYearly() {
        return priceYearly;
    }

    public void setPriceYearly(String priceYearly) {
        this.priceYearly = priceYearly;
    }

    public String getReturnUrl() {
        return returnUrl;
    }

    public void setReturnUrl(String returnUrl) {
        this.returnUrl = returnUrl;
    }
}
