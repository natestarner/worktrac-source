package com.worktrac.backend.billing;

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
    public SubscriptionDto subscription() {
        return subscriptionService.describe(currentUser.accountId());
    }

    public record CheckoutRequest(@NotNull BillingInterval interval) {
    }

    // The client sends MONTH or YEAR -- never a Stripe price id. Accepting one from a browser would
    // let a caller check out against any price they cared to invent.
    @PostMapping("/checkout-session")
    @Transactional
    public Map<String, String> createCheckoutSession(@Valid @RequestBody CheckoutRequest request) {
        requireStripe();
        Long accountId = currentUser.accountId();
        if (!rateLimiter.tryConsumePerAccount(accountId)) {
            throw new TooManyRequestsException("Too many checkout attempts. Try again shortly.");
        }

        Subscription subscription = subscriptionService.getOrCreate(requireAccount(accountId));

        // Refuse when the household is already entitled. Without this, two devices (or two taps in
        // two tabs) can each open a checkout and end up with a household paying twice.
        if (subscriptionService.isPro(subscription)) {
            throw new ForbiddenException("This household already has Pro.");
        }

        try {
            // Reuse an existing Stripe Customer rather than creating a second one for a returning
            // or previously-cancelled household -- two Customers for one account is painful to
            // unwind, since each carries its own subscriptions and payment methods.
            String customerId = subscription.getStripeCustomerId();
            if (customerId == null) {
                String email = userRepository.findByAccount_Id(accountId)
                        .map(user -> user.getEmail())
                        .orElse(null);
                customerId = stripeService.createCustomer(accountId, email,
                        subscription.getAccount().getName());
                subscription.setStripeCustomerId(customerId);
            }

            String clientSecret = stripeService.createEmbeddedCheckoutSession(
                    accountId, customerId, request.interval());
            auditService.record(accountId, BillingEventType.CHECKOUT_STARTED,
                    "interval=" + request.interval());
            return Map.of("clientSecret", clientSecret, "publishableKey", stripeService.publishableKey());
        } catch (StripeException e) {
            // The real reason, not just an event-type label -- same rule the registration audit
            // trail follows.
            auditService.record(accountId, BillingEventType.CHECKOUT_STARTED,
                    "FAILED: " + e.getMessage());
            log.error("Stripe checkout session creation failed for account {}", accountId, e);
            throw new ServiceUnavailableException("Could not reach our payment provider. Try again shortly.");
        }
    }

    // Reads a completed checkout back from Stripe and applies it SYNCHRONOUSLY. This -- not the
    // webhook -- is what makes the upgrade visible the instant the browser returns, which avoids
    // the classic "I paid and I'm still on Free" support ticket. The webhook is the backstop.
    @PostMapping("/checkout-session/{sessionId}/reconcile")
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
                    "status=" + state.status() + " interval=" + state.billingInterval());
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
