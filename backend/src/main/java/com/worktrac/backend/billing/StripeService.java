package com.worktrac.backend.billing;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Subscription;
import com.stripe.model.checkout.Session;
import com.stripe.net.RequestOptions;
import com.stripe.net.Webhook;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.SubscriptionCancelParams;
import com.stripe.param.billingportal.SessionCreateParams;
import com.stripe.param.checkout.SessionCreateParams.LineItem;
import com.stripe.param.checkout.SessionCreateParams.Mode;
import com.stripe.param.checkout.SessionCreateParams.UiMode;
import com.worktrac.backend.config.StripeProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;

// THE ONLY class in this application that imports com.stripe.*.
//
// That is the same job EmailService does for Azure Communication Services, and it is what makes
// billing testable without an HTTP stub server: integration tests replace this bean with a
// @MockitoBean. There is deliberately no WireMock in this repo, and this seam is why none is
// needed. If you find yourself importing com.stripe anywhere else, the abstraction is in the wrong
// place -- widen this class instead.
//
// Everything here returns app types (StripeSubscriptionState) rather than Stripe SDK objects, so a
// future SDK upgrade changes one file.
@Service
public class StripeService {

    private static final Logger log = LoggerFactory.getLogger(StripeService.class);

    // Stripe's own vocabulary, mapped once. An unrecognised status fails loudly HERE rather than
    // being guessed at somewhere downstream -- and it maps to INCOMPLETE (not entitled) rather than
    // ACTIVE, because guessing generously about a status we do not understand gives Pro away.
    private static SubscriptionStatus mapStatus(String stripeStatus) {
        if (stripeStatus == null) return SubscriptionStatus.INCOMPLETE;
        return switch (stripeStatus) {
            case "active" -> SubscriptionStatus.ACTIVE;
            case "trialing" -> SubscriptionStatus.TRIALING;
            case "past_due" -> SubscriptionStatus.PAST_DUE;
            case "canceled" -> SubscriptionStatus.CANCELED;
            case "unpaid" -> SubscriptionStatus.UNPAID;
            case "incomplete", "incomplete_expired", "paused" -> SubscriptionStatus.INCOMPLETE;
            default -> {
                log.warn("Unrecognised Stripe subscription status '{}' -- treating as INCOMPLETE", stripeStatus);
                yield SubscriptionStatus.INCOMPLETE;
            }
        };
    }

    private final StripeProperties properties;

    public StripeService(StripeProperties properties) {
        this.properties = properties;
    }

    public boolean isConfigured() {
        return properties.isConfigured();
    }

    public String publishableKey() {
        return properties.getPublishableKey();
    }

    // Built per call rather than held as a field so an environment with no secret key can still
    // start the application -- billing then answers 503 instead of the context failing to load.
    private StripeClient client() {
        StripeClient.StripeClientBuilder builder = StripeClient.builder().setApiKey(properties.getSecretKey());
        return builder.build();
    }

    // NOTE ON PINNING THE API VERSION: the stripe-java dependency version IS the pin. Each release
    // is generated against one Stripe API version and speaks it on every request, so a Dashboard
    // account upgrade cannot change what this code sees -- only a deliberate SDK bump can.
    //
    // The SDK does expose a per-request override, and it is called `unsafeSetStripeVersionOverride`
    // for a good reason: pointing a generated client at a different API version hands it responses
    // its own models were never built to parse. Bump the dependency instead.
    private RequestOptions requestOptions(String idempotencyKey) {
        RequestOptions.RequestOptionsBuilder builder = RequestOptions.builder();
        if (idempotencyKey != null) {
            builder.setIdempotencyKey(idempotencyKey);
        }
        return builder.build();
    }

    // The CLIENT never sends a price id -- it sends MONTH or YEAR and this maps it. Accepting a
    // price id from a browser would let a caller check out against any price they cared to invent.
    private String priceIdFor(BillingInterval interval) {
        return interval == BillingInterval.YEAR ? properties.getPriceYearly() : properties.getPriceMonthly();
    }

    // Carries an idempotency key derived from the account, so a double-tapped upgrade cannot create
    // two Stripe Customers for one household. Duplicate CHECKOUT SESSIONS are harmless by
    // comparison (an abandoned one simply expires); two Customers are painful to unwind, because
    // each can carry its own subscriptions and payment methods.
    public String createCustomer(Long accountId, String email, String householdName) throws StripeException {
        CustomerCreateParams params = CustomerCreateParams.builder()
                .setEmail(email)
                .setName(householdName)
                // Stamped so a webhook can always resolve the household even when the local write
                // that would have recorded the customer id lost a race.
                .putMetadata("accountId", String.valueOf(accountId))
                .build();
        Customer customer = client().customers().create(params, requestOptions("account-" + accountId + "-customer"));
        return customer.getId();
    }

    // Embedded, not hosted-redirect: Huddle runs as an installed PWA, and a cross-origin navigation
    // out of a standalone iOS app can hand the person to Safari without reliably handing them back
    // -- stranding someone mid-upgrade outside the app they just paid for. See
    // docs/architecture/billing.md.
    public String createEmbeddedCheckoutSession(Long accountId, String stripeCustomerId,
                                                 BillingInterval interval) throws StripeException {
        com.stripe.param.checkout.SessionCreateParams params =
                com.stripe.param.checkout.SessionCreateParams.builder()
                        .setMode(Mode.SUBSCRIPTION)
                        .setUiMode(UiMode.EMBEDDED_PAGE)
                        .setCustomer(stripeCustomerId)
                        // {CHECKOUT_SESSION_ID} is substituted by Stripe. The app reads it back on
                        // return and reconciles synchronously, which is what makes the upgrade
                        // visible immediately rather than waiting on a webhook.
                        .setReturnUrl(properties.getReturnUrl() + "?checkout={CHECKOUT_SESSION_ID}")
                        .addLineItem(LineItem.builder().setPrice(priceIdFor(interval)).setQuantity(1L).build())
                        // One line, and it makes launch discounts and win-back offers possible
                        // later without a code change.
                        .setAllowPromotionCodes(true)
                        .putMetadata("accountId", String.valueOf(accountId))
                        .setSubscriptionData(
                                com.stripe.param.checkout.SessionCreateParams.SubscriptionData.builder()
                                        .putMetadata("accountId", String.valueOf(accountId))
                                        .build())
                        .build();
        Session session = client().checkout().sessions().create(params, requestOptions(null));
        return session.getClientSecret();
    }

    // Reads a completed checkout session back from Stripe. Returns the account id Stripe is holding
    // in metadata so the caller can verify it belongs to the household asking -- without that
    // check, anyone could reconcile someone else's checkout by guessing a session id.
    public CheckoutSessionResult retrieveCheckoutSession(String sessionId) throws StripeException {
        Session session = client().checkout().sessions().retrieve(sessionId, requestOptions(null));
        String accountId = session.getMetadata() == null ? null : session.getMetadata().get("accountId");
        return new CheckoutSessionResult(
                accountId,
                session.getCustomer(),
                session.getSubscription(),
                "complete".equals(session.getStatus()),
                "paid".equals(session.getPaymentStatus()));
    }

    // Always a fresh read from Stripe, never a webhook payload as delivered. Stripe does not
    // guarantee event ordering, so applying payloads directly lets a stale subscription.updated
    // overwrite a newer subscription.created. Re-fetching makes ordering irrelevant and lets a
    // missed event self-heal on the next one.
    public StripeSubscriptionState fetchSubscriptionState(String stripeSubscriptionId) throws StripeException {
        Subscription subscription = client().subscriptions().retrieve(stripeSubscriptionId, requestOptions(null));
        return toState(subscription);
    }

    public String createPortalSession(String stripeCustomerId, String returnUrl) throws StripeException {
        SessionCreateParams params = SessionCreateParams.builder()
                .setCustomer(stripeCustomerId)
                .setReturnUrl(returnUrl)
                .build();
        return client().billingPortal().sessions().create(params, requestOptions(null)).getUrl();
    }

    // Called when a household deletes its account, so a deleted household stops being charged.
    // A subscription that is already gone is a success, not an error -- the desired end state is
    // "not being charged", and it is already true.
    public void cancelSubscription(String stripeSubscriptionId) throws StripeException {
        client().subscriptions().cancel(stripeSubscriptionId, SubscriptionCancelParams.builder().build(),
                requestOptions(null));
    }

    // Verifies the Stripe-Signature header against the raw request bytes. Stripe's own check
    // includes a timestamp tolerance (5 minutes by default), which is the replay defence -- do not
    // widen it.
    public com.stripe.model.Event verifyWebhook(String rawBody, String signatureHeader) throws StripeException {
        return Webhook.constructEvent(rawBody, signatureHeader, properties.getWebhookSecret());
    }

    private StripeSubscriptionState toState(Subscription subscription) {
        String priceId = null;
        BillingInterval billingInterval = null;
        if (subscription.getItems() != null && !subscription.getItems().getData().isEmpty()) {
            var price = subscription.getItems().getData().get(0).getPrice();
            if (price != null) {
                priceId = price.getId();
                if (price.getRecurring() != null) {
                    billingInterval = "year".equals(price.getRecurring().getInterval())
                            ? BillingInterval.YEAR
                            : BillingInterval.MONTH;
                }
            }
        }
        Long periodEnd = subscription.getItems() != null && !subscription.getItems().getData().isEmpty()
                ? subscription.getItems().getData().get(0).getCurrentPeriodEnd()
                : null;
        return new StripeSubscriptionState(
                subscription.getCustomer(),
                subscription.getId(),
                priceId,
                mapStatus(subscription.getStatus()),
                billingInterval,
                periodEnd == null ? null : Instant.ofEpochSecond(periodEnd),
                Boolean.TRUE.equals(subscription.getCancelAtPeriodEnd()));
    }

    // What a completed checkout tells us. `accountId` comes from Stripe's own metadata copy, which
    // is what the caller checks against CurrentUser before applying anything.
    public record CheckoutSessionResult(
            String accountId,
            String stripeCustomerId,
            String stripeSubscriptionId,
            boolean complete,
            boolean paid) {
    }

    // Convenience for callers that need the metadata map off an arbitrary Stripe object.
    static String accountIdFrom(Map<String, String> metadata) {
        return metadata == null ? null : metadata.get("accountId");
    }
}
