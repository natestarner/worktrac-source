package com.worktrac.backend.billing;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    // Stripe's own vocabulary, mapped once. An unrecognised status fails loudly HERE rather than
    // being guessed at somewhere downstream -- and it maps to INCOMPLETE (not entitled) rather than
    // ACTIVE, because guessing generously about a status we do not understand gives Plus away.
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
    //
    // WEBHOOKS ARE THE EXCEPTION: their payloads are shaped by each webhook ENDPOINT's own API
    // version in the Dashboard, which an SDK bump does not move. See verifyWebhook.
    private RequestOptions requestOptions(String idempotencyKey) {
        RequestOptions.RequestOptionsBuilder builder = RequestOptions.builder();
        if (idempotencyKey != null) {
            builder.setIdempotencyKey(idempotencyKey);
        }
        return builder.build();
    }

    // The CLIENT never sends a price id -- it sends a PlanSku's worth of symbols (plan, band,
    // interval) and StripeProperties maps it. Accepting a price id from a browser would let a
    // caller check out against any price they cared to invent.
    //
    // An unconfigured SKU throws rather than falling back to another price: checking somebody out
    // against a tier they did not choose is worse than refusing, and BillingController already
    // answers 503 for the environment-not-configured case before reaching here.
    private String priceIdFor(PlanSku sku) {
        return properties.priceIdFor(sku).orElseThrow(() -> new IllegalStateException(
                "No Stripe price configured for " + sku));
    }

    // Carries an idempotency key derived from the account, so a double-tapped upgrade cannot create
    // two Stripe Customers for one household. Duplicate CHECKOUT SESSIONS are harmless by
    // comparison (an abandoned one simply expires); two Customers are painful to unwind, because
    // each can carry its own subscriptions and payment methods.
    public String createCustomer(Long accountId, String email, String accountName) throws StripeException {
        CustomerCreateParams params = CustomerCreateParams.builder()
                .setEmail(email)
                .setName(accountName)
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
                                                 PlanSku sku) throws StripeException {
        com.stripe.param.checkout.SessionCreateParams params =
                com.stripe.param.checkout.SessionCreateParams.builder()
                        .setMode(Mode.SUBSCRIPTION)
                        .setUiMode(UiMode.EMBEDDED_PAGE)
                        .setCustomer(stripeCustomerId)
                        // {CHECKOUT_SESSION_ID} is substituted by Stripe. The app reads it back on
                        // return and reconciles synchronously, which is what makes the upgrade
                        // visible immediately rather than waiting on a webhook.
                        .setReturnUrl(properties.getReturnUrl() + "?checkout={CHECKOUT_SESSION_ID}")
                        .addLineItem(LineItem.builder().setPrice(priceIdFor(sku)).setQuantity(1L).build())
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

    /**
     * A HOSTED checkout (Stripe's own page, opened in the phone's browser) for the App Store app on
     * the US storefront, where Apple allows a link out to a web checkout but not payment UI inside
     * the app. Everything that decides what is bought -- the price mapping, the account metadata on
     * both the session and the subscription, promotion codes -- is identical to the embedded one, so
     * the webhook, the reconcile endpoint and the watchdog treat the result exactly the same.
     *
     * <p>Stripe redirects to {@code successUrl}/{@code cancelUrl} in the BROWSER, not the app; the
     * app finishes the purchase by reconciling the session id it already holds when it comes back to
     * the foreground. No deep link is involved, so a redirect from checkout.stripe.com that fails to
     * reopen the app strands nobody. UI mode is left unset, which is hosted.
     */
    public HostedCheckout createHostedCheckoutSession(Long accountId, String stripeCustomerId, PlanSku sku,
                                                      String successUrl, String cancelUrl) throws StripeException {
        com.stripe.param.checkout.SessionCreateParams params =
                com.stripe.param.checkout.SessionCreateParams.builder()
                        .setMode(Mode.SUBSCRIPTION)
                        .setCustomer(stripeCustomerId)
                        .setSuccessUrl(successUrl)
                        .setCancelUrl(cancelUrl)
                        .addLineItem(LineItem.builder().setPrice(priceIdFor(sku)).setQuantity(1L).build())
                        .setAllowPromotionCodes(true)
                        .putMetadata("accountId", String.valueOf(accountId))
                        .setSubscriptionData(
                                com.stripe.param.checkout.SessionCreateParams.SubscriptionData.builder()
                                        .putMetadata("accountId", String.valueOf(accountId))
                                        .build())
                        .build();
        Session session = client().checkout().sessions().create(params, requestOptions(null));
        return new HostedCheckout(session.getUrl(), session.getId());
    }

    public record HostedCheckout(String url, String sessionId) {
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
    //
    // ⚠️ THE IDS ARE READ FROM THE SIGNED RAW JSON, NEVER FROM THE SDK'S TYPED MODELS. stripe-java
    // only deserializes an event's data object when the event's API release train matches its own
    // (EventDataObjectDeserializer.getObject() is empty otherwise), and the train an event arrives
    // in is set by the webhook ENDPOINT's configuration in the Stripe Dashboard -- not by this code.
    // Built on getObject(), the 33 -> 34 bump (dahlia -> endive) would have left every webhook
    // unattributable until each endpoint was upgraded by hand. Object type, metadata.accountId,
    // customer and subscription are stable across versions, and the subscription itself is always
    // re-fetched at the SDK's own version. Pinned by StripeWebhookAttributionTest.
    public WebhookEvent verifyWebhook(String rawBody, String signatureHeader) throws StripeException {
        com.stripe.model.Event event = Webhook.constructEvent(rawBody, signatureHeader, properties.getWebhookSecret());
        return webhookEventFrom(event.getId(), event.getType(), rawBody);
    }

    private static WebhookEvent webhookEventFrom(String id, String type, String rawBody) {
        JsonNode object;
        try {
            object = OBJECT_MAPPER.readTree(rawBody).path("data").path("object");
        } catch (JsonProcessingException e) {
            // Unreachable in practice: constructEvent has already parsed these exact bytes.
            throw new IllegalArgumentException("Stripe webhook body is not JSON", e);
        }
        String accountId = textOf(object.path("metadata").path("accountId"));
        String customerId = idOf(object.path("customer"));
        // Same per-type reading the typed models gave: only a session and a subscription carry our
        // metadata, and an invoice is attributed through its customer alone.
        return switch (String.valueOf(textOf(object.path("object")))) {
            case "checkout.session" -> new WebhookEvent(id, type, accountId, customerId, idOf(object.path("subscription")));
            case "subscription" -> new WebhookEvent(id, type, accountId, customerId, textOf(object.path("id")));
            case "invoice" -> new WebhookEvent(id, type, null, customerId, null);
            default -> new WebhookEvent(id, type, null, null, null);
        };
    }

    private static String textOf(JsonNode node) {
        return node.isTextual() ? node.asText() : null;
    }

    // An expandable field arrives as a bare id in a webhook, but as an object if it was expanded.
    private static String idOf(JsonNode node) {
        return node.isObject() ? textOf(node.path("id")) : textOf(node);
    }

    // What a verified webhook says, as app types. Any field may be null -- the controller decides
    // what an unattributable event means.
    public record WebhookEvent(
            String id,
            String type,
            String accountId,
            String stripeCustomerId,
            String stripeSubscriptionId) {
    }

    // Package-private for StripeSubscriptionStateTest, which pins the cancellation mapping. That
    // mapping reads a field Stripe has deprecated alongside its replacement, which is precisely the
    // kind of thing that rots silently -- a test is the only thing that will notice.
    StripeSubscriptionState toState(Subscription subscription) {
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

        // ⚠️ READ BOTH CANCELLATION SIGNALS. `cancel_at_period_end` is deprecated: Stripe replaced
        // it with `cancel_at`, a timestamp, and the Customer Portal now sets THAT. Reading only the
        // boolean meant a household could cancel in the portal, see "Cancels Aug 28" there, and
        // still be told "Renews Aug 28" by us -- found by doing exactly that against the sandbox.
        //
        // Same migration that already moved `current_period_end` off the subscription and onto its
        // items (see above). Keep both readings: the boolean still arrives from older integrations
        // and from the API, and a subscription that is ending should read as ending either way.
        Long cancelAt = subscription.getCancelAt();
        boolean cancelling = Boolean.TRUE.equals(subscription.getCancelAtPeriodEnd()) || cancelAt != null;

        // When Stripe names an explicit cancellation moment, THAT is when service ends -- so it is
        // what the screen should show, not the billing period end. For an ordinary period-end
        // cancellation the two are the same value; with the newer flexible cancellation they need
        // not be, and the person cares about the date their access actually stops.
        Long endsAt = cancelAt != null ? cancelAt : periodEnd;

        return new StripeSubscriptionState(
                subscription.getCustomer(),
                subscription.getId(),
                priceId,
                mapStatus(subscription.getStatus()),
                billingInterval,
                endsAt == null ? null : Instant.ofEpochSecond(endsAt),
                cancelling);
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
}
