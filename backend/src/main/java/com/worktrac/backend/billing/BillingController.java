package com.worktrac.backend.billing;

import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.membership.Permission;
import com.stripe.exception.StripeException;
import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ForbiddenException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.common.ServiceUnavailableException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.config.StripeProperties;
import com.worktrac.backend.ratelimit.BillingRateLimiter;
import com.worktrac.backend.security.CurrentUser;
import com.worktrac.backend.user.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

// Authenticated billing endpoints. Every one resolves the household through CurrentUser.accountId()
// and never from anything the client sent -- that is the account-scoping boundary for the whole app
// (.claude/rules/backend-core.md), and it matters more here than anywhere else.
@RestController
@RequestMapping("/api/billing")
public class BillingController {

    private static final Logger log = LoggerFactory.getLogger(BillingController.class);

    private final CurrentUser currentUser;
    private final SubscriptionService subscriptionService;
    private final StripeService stripeService;
    private final StripeProperties stripeProperties;
    private final BillingAuditService auditService;
    private final BillingRateLimiter rateLimiter;
    private final AccountRepository accountRepository;
    private final UserRepository userRepository;

    public BillingController(CurrentUser currentUser, SubscriptionService subscriptionService,
                              StripeService stripeService, StripeProperties stripeProperties,
                              BillingAuditService auditService, BillingRateLimiter rateLimiter,
                              AccountRepository accountRepository, UserRepository userRepository) {
        this.currentUser = currentUser;
        this.subscriptionService = subscriptionService;
        this.stripeService = stripeService;
        this.stripeProperties = stripeProperties;
        this.auditService = auditService;
        this.rateLimiter = rateLimiter;
        this.accountRepository = accountRepository;
        this.userRepository = userRepository;
    }

    // Deliberately NOT gated on isConfigured: reading your own plan must work in an environment
    // with no Stripe at all. A household on Free is still on Free, and answering 503 here would
    // make the billing screen unreadable in local development for no reason.
    @GetMapping("/subscription")
    @RequiresPermission(anyMember = true)
    public SubscriptionDto subscription() {
        return subscriptionService.describe(currentUser.accountId());
    }

    /**
     * What the client is buying, in SYMBOLS the server maps -- never a Stripe price id.
     *
     * <p>{@code plan} is nullable for compatibility with the shape this endpoint had when PLUS was
     * the only thing for sale: a body carrying only an interval still means Plus. {@code band} is
     * required for PRO and forbidden for PLUS, which {@link PlanSku#of} enforces by simply not
     * having a constant for the other combinations.
     */
    public record CheckoutRequest(BillingPlan plan, ClientBand band, @NotNull BillingInterval interval) {

        BillingPlan planOrDefault() {
            return plan == null ? BillingPlan.PLUS : plan;
        }
    }

    // The client sends plan + band + interval -- never a Stripe price id. Accepting one from a
    // browser would let a caller check out against any price they cared to invent.
    @PostMapping("/checkout-session")
    @RequiresPermission(Permission.MANAGE_BILLING)
    @Transactional
    public Map<String, String> createCheckoutSession(@Valid @RequestBody CheckoutRequest request) {
        CheckoutTarget target = prepareCheckout(request);
        try {
            String clientSecret = stripeService.createEmbeddedCheckoutSession(
                    target.accountId(), target.customerId(), target.sku());
            auditService.record(target.accountId(), BillingEventType.CHECKOUT_STARTED,
                    "sku=" + target.sku());
            return Map.of("clientSecret", clientSecret, "publishableKey", stripeService.publishableKey());
        } catch (StripeException e) {
            // The real reason, not just an event-type label -- same rule the registration audit
            // trail follows.
            auditService.record(target.accountId(), BillingEventType.CHECKOUT_STARTED,
                    "FAILED: " + e.getMessage());
            log.error("Stripe checkout session creation failed for account {}", target.accountId(), e);
            throw new ServiceUnavailableException("Could not reach our payment provider. Try again shortly.");
        }
    }

    /**
     * The App Store app's checkout on the US storefront: a link to Stripe's HOSTED page, opened in
     * the phone's browser, because Apple allows linking out to a web checkout there but not payment
     * UI inside the app. Same request, same guards and same price mapping as the embedded checkout
     * above ({@link #prepareCheckout}), so a household cannot buy anything here that it could not
     * buy on the web, and the webhook, reconcile and watchdog handle the result identically.
     *
     * <p>Answers {@code {url, sessionId}}. The app keeps the session id and reconciles it through
     * the existing {@code /checkout-session/{id}/reconcile} when it returns to the foreground;
     * Stripe sends the browser to {@code /checkout-complete}, which only tells the person to go back
     * to the app. Additive: the web never calls it.
     */
    @PostMapping("/checkout-link")
    @RequiresPermission(Permission.MANAGE_BILLING)
    @Transactional
    public Map<String, String> createCheckoutLink(@Valid @RequestBody CheckoutRequest request) {
        CheckoutTarget target = prepareCheckout(request);
        String origin = appOrigin();
        try {
            StripeService.HostedCheckout checkout = stripeService.createHostedCheckoutSession(
                    target.accountId(), target.customerId(), target.sku(),
                    origin + "/checkout-complete?session_id={CHECKOUT_SESSION_ID}",
                    origin + "/checkout-complete?cancelled=1");
            // "hosted" + the session id are the app's upgrade funnel: every link opened, joinable to
            // the CHECKOUT_RECONCILED row for the same session (query in billing.md). It is the data
            // that decides, later, whether In-App Purchase would earn more despite Apple's cut.
            auditService.record(target.accountId(), BillingEventType.CHECKOUT_STARTED,
                    "sku=" + target.sku() + " hosted session=" + checkout.sessionId());
            return Map.of("url", checkout.url(), "sessionId", checkout.sessionId());
        } catch (StripeException e) {
            auditService.record(target.accountId(), BillingEventType.CHECKOUT_STARTED,
                    "FAILED (hosted): " + e.getMessage());
            log.error("Stripe hosted checkout creation failed for account {}", target.accountId(), e);
            throw new ServiceUnavailableException("Could not reach our payment provider. Try again shortly.");
        }
    }

    private record CheckoutTarget(Long accountId, String customerId, PlanSku sku) {
    }

    // Everything both checkouts must refuse or resolve before Stripe is asked for anything. One copy,
    // so the embedded and hosted checkouts cannot drift apart on who may buy what.
    private CheckoutTarget prepareCheckout(CheckoutRequest request) {
        requireStripe();
        Long accountId = currentUser.accountId();
        if (!rateLimiter.tryConsumePerAccount(accountId)) {
            throw new TooManyRequestsException("Too many checkout attempts. Try again shortly.");
        }

        Subscription subscription = subscriptionService.getOrCreate(requireAccount(accountId));

        // Refuse when the household is already entitled. Without this, two devices (or two taps in
        // two tabs) can each open a checkout and end up with a household paying twice.
        //
        // isEntitled, not a tier comparison: the question is "are they already paying", and any
        // paid tier answers it. A second checkout is how a household ends up with two Stripe
        // subscriptions regardless of which tiers they name.
        if (subscriptionService.isEntitled(subscription)) {
            throw new ForbiddenException("This account already has a paid plan.");
        }

        // Which of the ten things we sell is this? A combination we do not sell -- FREE, PLUS with
        // a band, PRO without one -- is a 400 with a message rather than a 500 from deeper in.
        PlanSku sku = PlanSku.of(request.planOrDefault(), request.band(), request.interval())
                .orElseThrow(() -> new IllegalArgumentException("That isn't a plan you can buy."));

        // Separate from requireStripe(): "Stripe is wired up here" and "this environment sells this
        // tier" are different questions. An environment can legitimately have Plus prices and no
        // Pro ones -- during the rollout of a new tier, that is every environment for a while --
        // and conflating them would have switched off Plus checkout over a missing Pro env var.
        if (stripeProperties.priceIdFor(sku).isEmpty()) {
            throw new ServiceUnavailableException("That plan isn't available yet.");
        }

        try {
            // Reuse an existing Stripe Customer rather than creating a second one for a returning
            // or previously-cancelled household -- two Customers for one account is painful to
            // unwind, since each carries its own subscriptions and payment methods.
            String customerId = subscription.getStripeCustomerId();
            if (customerId == null) {
                // The OWNER's address specifically. Receipts and dunning mail must reach whoever is
                // paying -- a member's inbox is neither the right destination nor stable, since
                // members come and go while the owner is the billing relationship.
                String email = userRepository.findOwners(accountId).stream()
                        .findFirst()
                        .map(user -> user.getEmail())
                        .orElse(null);
                customerId = stripeService.createCustomer(accountId, email,
                        subscription.getAccount().getName());
                subscription.setStripeCustomerId(customerId);
            }

            return new CheckoutTarget(accountId, customerId, sku);
        } catch (StripeException e) {
            auditService.record(accountId, BillingEventType.CHECKOUT_STARTED,
                    "FAILED: " + e.getMessage());
            log.error("Stripe customer creation failed for account {}", accountId, e);
            throw new ServiceUnavailableException("Could not reach our payment provider. Try again shortly.");
        }
    }

    // The app's origin, from the embedded checkout's own return URL (e.g.
    // https://app.huddle.fitness/app/billing). Derived rather than configured, so the hosted
    // checkout's landing page needs no new setting in the three places billing config lives.
    private String appOrigin() {
        java.net.URI uri = java.net.URI.create(stripeProperties.getReturnUrl());
        String port = uri.getPort() == -1 ? "" : ":" + uri.getPort();
        return uri.getScheme() + "://" + uri.getHost() + port;
    }

    // Reads a completed checkout back from Stripe and applies it SYNCHRONOUSLY. This -- not the
    // webhook -- is what makes the upgrade visible the instant the browser returns, which avoids
    // the classic "I paid and I'm still on Free" support ticket. The webhook is the backstop.
    @PostMapping("/checkout-session/{sessionId}/reconcile")
    @RequiresPermission(Permission.MANAGE_BILLING)
    @Transactional
    public SubscriptionDto reconcileCheckout(@PathVariable String sessionId) {
        requireStripe();
        Long accountId = currentUser.accountId();

        try {
            StripeService.CheckoutSessionResult result = stripeService.retrieveCheckoutSession(sessionId);

            // ⚠️ THE OWNERSHIP CHECK. Without it, anyone could reconcile someone else's checkout by
            // guessing a session id -- attaching another household's subscription to their own.
            // Stripe's own metadata copy is the authority here, never anything the client sent.
            if (result.accountId() == null || !result.accountId().equals(String.valueOf(accountId))) {
                auditService.record(accountId, BillingEventType.WEBHOOK_REJECTED,
                        "Checkout session " + sessionId + " does not belong to this account");
                throw new ForbiddenException("That checkout does not belong to this household.");
            }

            if (!result.complete() || result.stripeSubscriptionId() == null) {
                // Not an error: the browser can return before Stripe has finished. The screen polls,
                // and the webhook will land regardless.
                return subscriptionService.describe(accountId);
            }

            Subscription subscription = subscriptionService.getOrCreate(requireAccount(accountId));
            StripeSubscriptionState state = stripeService.fetchSubscriptionState(result.stripeSubscriptionId());
            subscriptionService.applyStripeState(subscription, state);
            auditService.record(accountId, BillingEventType.CHECKOUT_RECONCILED,
                    "status=" + state.status() + " interval=" + state.billingInterval()
                            + " session=" + sessionId);
            return subscriptionService.describe(accountId);
        } catch (StripeException e) {
            log.error("Stripe checkout reconcile failed for account {}", accountId, e);
            throw new ServiceUnavailableException("Could not confirm that payment yet. It will appear shortly.");
        }
    }

    // The hosted Customer Portal: card updates, invoices, plan switches and cancellation. Redirect
    // only -- Stripe has no embedded variant -- so the frontend opens it in a NEW TAB, leaving the
    // installed PWA's own document alive behind it.
    @PostMapping("/portal-session")
    @RequiresPermission(Permission.MANAGE_BILLING)
    public Map<String, String> createPortalSession() {
        requireStripe();
        Long accountId = currentUser.accountId();
        if (!rateLimiter.tryConsumePerAccount(accountId)) {
            throw new TooManyRequestsException("Too many attempts. Try again shortly.");
        }

        Subscription subscription = subscriptionService.findByAccountId(accountId)
                .orElseThrow(() -> new NotFoundException("No subscription for this household"));
        if (subscription.getStripeCustomerId() == null) {
            throw new NotFoundException("This household has never had a subscription to manage.");
        }

        try {
            String url = stripeService.createPortalSession(
                    subscription.getStripeCustomerId(), stripeProperties.getReturnUrl());
            auditService.record(accountId, BillingEventType.PORTAL_OPENED, null);
            return Map.of("url", url);
        } catch (StripeException e) {
            log.error("Stripe portal session creation failed for account {}", accountId, e);
            throw new ServiceUnavailableException("Could not open billing management. Try again shortly.");
        }
    }

    // An unconfigured environment refuses rather than pretending nobody is subscribed. 503 and not
    // 500, because this is expected and temporary from the caller's point of view.
    private void requireStripe() {
        if (!stripeService.isConfigured()) {
            throw new ServiceUnavailableException("Billing is not available in this environment.");
        }
    }

    private Account requireAccount(Long accountId) {
        return accountRepository.findById(accountId)
                .orElseThrow(() -> new NotFoundException("We couldn't find that account."));
    }
}
