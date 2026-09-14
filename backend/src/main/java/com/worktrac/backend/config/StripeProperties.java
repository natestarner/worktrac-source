package com.worktrac.backend.config;

import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.PlanSku;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

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

    // One Stripe Price id per thing we sell, keyed by PlanSku.name(). See PlanSku for why the enum
    // constant IS the key.
    //
    // ⚠️ A MAP RATHER THAN A FIELD PER PRICE, because the set is no longer two. Pro is priced by
    // client band, so it is four bands x two intervals on its own, and Team will add more. Ten
    // getters would be ten places to forget one.
    //
    // ⚠️ ENTRIES ARE ALLOWED TO BE MISSING, and `sells(plan)` is per-tier because of it. An
    // environment must be able to sell Plus before the Pro prices exist in that Stripe mode --
    // otherwise adding a tier means every environment is "unconfigured" until ten env vars land
    // simultaneously, and a half-configured environment would take a payment it cannot reconcile.
    private Map<String, String> prices = new LinkedHashMap<>();

    // Where Stripe returns the browser after embedded checkout. Per-environment because it is an
    // absolute URL: app.dev.huddle.fitness in lower, app.huddle.fitness in production.
    private String returnUrl;

    // The gate every billing entry point checks: is Stripe wired up here AT ALL? A partially
    // configured environment counts as unconfigured on purpose -- half a Stripe integration is
    // worse than none, since it can take a payment it cannot then reconcile.
    //
    // Note this asks nothing about prices any more. "Can we talk to Stripe" and "do we sell this
    // particular thing here" are different questions with different right answers, and conflating
    // them meant one missing Pro price would have switched off Plus checkout too.
    public boolean isConfigured() {
        return notBlank(secretKey) && notBlank(publishableKey) && notBlank(returnUrl);
    }

    /** Whether this environment can sell anything at all -- at least one SKU has a price id. */
    public boolean sellsAnything() {
        return Arrays.stream(PlanSku.values()).anyMatch(sku -> priceIdFor(sku).isPresent());
    }

    /** Whether this environment can sell the given tier: at least one of its SKUs has a price. */
    public boolean sells(BillingPlan plan) {
        return Arrays.stream(PlanSku.values())
                .anyMatch(sku -> sku.plan() == plan && priceIdFor(sku).isPresent());
    }

    /** The Stripe Price id for a SKU, or empty when this environment does not sell it. */
    public Optional<String> priceIdFor(PlanSku sku) {
        String priceId = prices.get(sku.name());
        return notBlank(priceId) ? Optional.of(priceId.trim()) : Optional.empty();
    }

    /**
     * Which SKU a Stripe Price id belongs to -- THE REVERSE DIRECTION, and the only way a webhook
     * can learn which tier a household bought.
     *
     * <p>Stripe hands us a price id and nothing else that names a tier, and billing.md requires
     * re-fetching the subscription and writing that rather than trusting a delivered payload. So
     * without this lookup a Pro subscription would be indistinguishable from a Plus one.
     *
     * <p>Empty is legitimate and must not throw: a price created in the Dashboard but never added
     * to this environment's config, or a subscription bought against a price that has since been
     * removed. The caller decides what to do with "paying, tier unknown" -- see
     * SubscriptionService.applyStripeState, which keeps the tier it already had rather than
     * downgrading somebody over a config gap.
     */
    public Optional<PlanSku> skuForPriceId(String priceId) {
        if (!notBlank(priceId)) {
            return Optional.empty();
        }
        String wanted = priceId.trim();
        return Arrays.stream(PlanSku.values())
                .filter(sku -> priceIdFor(sku).map(wanted::equals).orElse(false))
                .findFirst();
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

    public Map<String, String> getPrices() {
        return prices;
    }

    public void setPrices(Map<String, String> prices) {
        this.prices = prices == null ? new LinkedHashMap<>() : prices;
    }

    public String getReturnUrl() {
        return returnUrl;
    }

    public void setReturnUrl(String returnUrl) {
        this.returnUrl = returnUrl;
    }
}
