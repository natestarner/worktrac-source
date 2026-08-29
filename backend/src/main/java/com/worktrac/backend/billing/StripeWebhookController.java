package com.worktrac.backend.billing;

import com.stripe.exception.StripeException;
import com.stripe.model.Event;
import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.config.StripeProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;
import java.util.Set;

// Ingests Stripe's webhook deliveries -- the out-of-band truth about what actually happened to a
// subscription, as opposed to what the browser told us. Structurally a sibling of
// EmailDeliveryWebhookController, and for the same reasons.
//
// permitAll (see SecurityConfig) -- Stripe is a server-to-server caller with no JWT -- gated
// instead by Stripe's own request signature, verified against the RAW request bytes.
@RestController
@RequestMapping("/api/webhooks/stripe")
public class StripeWebhookController {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookController.class);

    // Every event that can change what a household is entitled to. Anything else is acknowledged
    // and recorded as IGNORED rather than silently dropped, so "we chose not to act" stays
    // distinguishable from "it never arrived".
    private static final Set<String> SUBSCRIPTION_EVENTS = Set.of(
            "checkout.session.completed",
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
            "invoice.paid",
            "invoice.payment_failed");

    private final StripeService stripeService;
    private final StripeProperties properties;
    private final SubscriptionService subscriptionService;
    private final SubscriptionRepository subscriptionRepository;
    private final BillingAuditService auditService;
    private final AccountRepository accountRepository;

    public StripeWebhookController(StripeService stripeService, StripeProperties properties,
                                    SubscriptionService subscriptionService,
                                    SubscriptionRepository subscriptionRepository,
                                    BillingAuditService auditService, AccountRepository accountRepository) {
        this.stripeService = stripeService;
        this.properties = properties;
        this.subscriptionService = subscriptionService;
        this.subscriptionRepository = subscriptionRepository;
        this.auditService = auditService;
        this.accountRepository = accountRepository;
    }

    // rawBody as a String, not a bound type: Stripe's signature is an HMAC over the exact bytes,
    // so anything that re-serializes the payload first invalidates it. (EmailDeliveryWebhookController
    // reads raw for a different reason -- a Jackson binding failure -- but lands on the same shape.)
    //
    // The signature header is optional at the binding level so a call with no header at all fails
    // the same explicit comparison below as a wrong one, rather than escaping as a framework-level
    // MissingRequestHeaderException that GlobalExceptionHandler would answer with a generic 500.
    @PostMapping
    @Transactional
    public ResponseEntity<?> receive(@RequestHeader(value = "Stripe-Signature", required = false) String signature,
                                      @RequestBody String rawBody) {
        // Empty secret ⇒ reject everything. An unconfigured environment must never accept an
        // unverified instruction to change what someone is entitled to.
        if (!properties.isWebhookConfigured()) {
            log.warn("Rejected Stripe webhook: no webhook secret configured in this environment");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        if (signature == null || signature.isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        Event event;
        try {
            // Stripe's own check includes a timestamp tolerance (5 minutes by default), which is
            // the replay defence. Do not widen it.
            event = stripeService.verifyWebhook(rawBody, signature);
        } catch (StripeException | IllegalArgumentException e) {
            auditService.record(null, BillingEventType.WEBHOOK_REJECTED, "Signature verification failed");
            log.warn("Rejected Stripe webhook: signature verification failed");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }

        Long accountId = resolveAccountId(event).orElse(null);

        // IDEMPOTENCY. Stripe redelivers events on its own retry schedule and on demand from the
        // Dashboard, so the same event id arriving twice is routine rather than exceptional. V57's
        // filtered unique index on stripe_event_id is the dedup point -- the duplicate insert
        // failing IS the "already seen" signal, with no check-then-insert race of its own.
        boolean firstSeen = auditService.recordIfFirstSeen(accountId, event.getId(),
                SUBSCRIPTION_EVENTS.contains(event.getType())
                        ? BillingEventType.WEBHOOK_APPLIED
                        : BillingEventType.WEBHOOK_IGNORED,
                "type=" + event.getType());
        if (!firstSeen) {
            return ResponseEntity.ok().build();
        }

        if (!SUBSCRIPTION_EVENTS.contains(event.getType())) {
            // Understood, deliberately not acted on. Already recorded as IGNORED above.
            return ResponseEntity.ok().build();
        }

        try {
            applyEvent(event, accountId);
        } catch (StripeException e) {
            auditService.record(accountId, BillingEventType.WEBHOOK_REJECTED,
                    "Could not re-fetch subscription: " + e.getMessage());
            log.error("Stripe webhook {} could not be applied", event.getId(), e);
            // 5xx so Stripe retries: we could not reach Stripe to re-fetch, which is transient.
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }

        // Always 200 for anything we understood, even when we chose not to act -- a non-2xx makes
        // Stripe retry the same event for days.
        return ResponseEntity.ok().build();
    }

    // ⚠️ RE-FETCH, NEVER APPLY THE PAYLOAD. Stripe does not guarantee event ordering, so a
    // subscription.updated can arrive after a subscription.created that describes newer state --
    // applying delivered payloads directly lets the stale one win. Reading the subscription back
    // from Stripe makes ordering irrelevant, and lets a missed event self-heal on the next one.
    private void applyEvent(Event event, Long accountId) throws StripeException {
        if (accountId == null) {
            auditService.record(null, BillingEventType.WEBHOOK_REJECTED,
                    "Could not attribute event " + event.getId() + " (" + event.getType() + ") to an account");
            log.warn("Stripe webhook {} could not be attributed to an account", event.getId());
            return;
        }

        Optional<Subscription> existing = subscriptionRepository.findByAccountId(accountId);
        Subscription subscription = existing.orElseGet(() -> {
            Account account = accountRepository.findById(accountId).orElse(null);
            return account == null ? null : subscriptionService.getOrCreate(account);
        });
        if (subscription == null) {
            auditService.record(accountId, BillingEventType.WEBHOOK_REJECTED,
                    "Event " + event.getId() + " names an account that no longer exists");
            return;
        }

        String stripeSubscriptionId = subscription.getStripeSubscriptionId();
        if (stripeSubscriptionId == null) {
            // A checkout.session.completed for a household whose local row has not recorded the
            // subscription id yet. The session carries it.
            stripeSubscriptionId = subscriptionIdFromEvent(event);
        }
        if (stripeSubscriptionId == null) {
            auditService.record(accountId, BillingEventType.WEBHOOK_IGNORED,
                    "Event " + event.getType() + " carries no subscription to re-fetch");
            return;
        }

        StripeSubscriptionState state = stripeService.fetchSubscriptionState(stripeSubscriptionId);
        subscriptionService.applyStripeState(subscription, state);
    }

    // metadata.accountId is stamped on both the Customer and the Checkout Session at creation, so
    // it is present on most events. The customer-id lookup is the fallback for Portal-initiated
    // changes, which do not always round-trip session metadata.
    //
    // NEVER trusted as an authorization decision -- this only decides WHICH household a
    // Stripe-signed event refers to, after the signature has already proved Stripe sent it.
    private Optional<Long> resolveAccountId(Event event) {
        Optional<String> fromMetadata = event.getDataObjectDeserializer().getObject()
                .filter(obj -> obj instanceof com.stripe.model.HasId)
                .flatMap(obj -> Optional.ofNullable(metadataAccountId(obj)));
        if (fromMetadata.isPresent()) {
            return fromMetadata.flatMap(StripeWebhookController::parseLong);
        }
        return customerIdFromEvent(event)
                .flatMap(subscriptionRepository::findByStripeCustomerId)
                .map(subscription -> subscription.getAccount().getId());
    }

    private static String metadataAccountId(Object stripeObject) {
        if (stripeObject instanceof com.stripe.model.checkout.Session session) {
            return StripeService.accountIdFrom(session.getMetadata());
        }
        if (stripeObject instanceof com.stripe.model.Subscription subscription) {
            return StripeService.accountIdFrom(subscription.getMetadata());
        }
        return null;
    }

    private static Optional<String> customerIdFromEvent(Event event) {
        return event.getDataObjectDeserializer().getObject().map(obj -> {
            if (obj instanceof com.stripe.model.checkout.Session session) return session.getCustomer();
            if (obj instanceof com.stripe.model.Subscription subscription) return subscription.getCustomer();
            if (obj instanceof com.stripe.model.Invoice invoice) return invoice.getCustomer();
            return null;
        }).filter(id -> id != null);
    }

    private static String subscriptionIdFromEvent(Event event) {
        return event.getDataObjectDeserializer().getObject().map(obj -> {
            if (obj instanceof com.stripe.model.checkout.Session session) return session.getSubscription();
            if (obj instanceof com.stripe.model.Subscription subscription) return subscription.getId();
            return null;
        }).orElse(null);
    }

    private static Optional<Long> parseLong(String value) {
        try {
            return Optional.of(Long.parseLong(value));
        } catch (NumberFormatException e) {
            return Optional.empty();
        }
    }
}
