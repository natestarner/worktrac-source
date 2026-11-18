package com.worktrac.backend.billing.store;

import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.billing.BillingAuditService;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.BillingInterval;
import com.worktrac.backend.billing.BillingPlan;
import com.worktrac.backend.billing.BillingSource;
import com.worktrac.backend.billing.ClientBand;
import com.worktrac.backend.billing.PlanSku;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionDto;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import com.worktrac.backend.common.ServiceUnavailableException;
import com.worktrac.backend.common.TooManyRequestsException;
import com.worktrac.backend.membership.Permission;
import com.worktrac.backend.membership.RequiresPermission;
import com.worktrac.backend.ratelimit.BillingRateLimiter;
import com.worktrac.backend.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * In-App Purchase, for every store, through one set of endpoints ({@code {store}} is
 * {@code app-store}, later {@code google-play}). See docs/in-app-purchase-plan.md.
 *
 * <pre>
 * GET  /api/billing/store/{store}/products   which product ids this environment sells (anyMember)
 * POST /api/billing/store/{store}/prepare    may this household buy, and with which token (owner)
 * POST /api/billing/store/{store}/release    the purchase sheet was dismissed (owner)
 * POST /api/billing/store/{store}/sync       here are the store's proofs; apply them (anyMember)
 * (the store's own server notifications are StoreWebhookController)
 * </pre>
 *
 * <p>Every household resolves through CurrentUser for the caller's OWN answers; what a store proof is
 * applied to is decided by the proof (StoreBillingService), never by the caller.
 */
@RestController
public class StoreBillingController {

    private static final Logger log = LoggerFactory.getLogger(StoreBillingController.class);

    /** How long a purchase may hold the household before another device may start one. */
    static final Duration PURCHASE_CLAIM = Duration.ofMinutes(10);

    /** At most this many proofs per sync: a restore of a household's whole history is a handful. */
    static final int MAX_PROOFS = 10;

    private final CurrentUser currentUser;
    private final StoreBillingProviders providers;
    private final StoreBillingService storeBillingService;
    private final SubscriptionService subscriptionService;
    private final SubscriptionRepository subscriptionRepository;
    private final AccountRepository accountRepository;
    private final BillingAuditService auditService;
    private final BillingRateLimiter rateLimiter;
    private final Clock clock;

    public StoreBillingController(CurrentUser currentUser, StoreBillingProviders providers,
                                  StoreBillingService storeBillingService, SubscriptionService subscriptionService,
                                  SubscriptionRepository subscriptionRepository, AccountRepository accountRepository,
                                  BillingAuditService auditService, BillingRateLimiter rateLimiter, Clock clock) {
        this.currentUser = currentUser;
        this.providers = providers;
        this.storeBillingService = storeBillingService;
        this.subscriptionService = subscriptionService;
        this.subscriptionRepository = subscriptionRepository;
        this.accountRepository = accountRepository;
        this.auditService = auditService;
        this.rateLimiter = rateLimiter;
        this.clock = clock;
    }

    public record StoreProduct(BillingPlan plan, ClientBand band, BillingInterval interval, String productId) {
    }

    /**
     * The store product ids this environment sells, so the app never holds a product id of its own
     * (Huddle and Huddle Lower use different ones). The app asks the store for their prices and shows
     * the store's own price strings; no price is ever stored here.
     */
    @GetMapping("/api/billing/store/{store}/products")
    @RequiresPermission(anyMember = true)
    public List<StoreProduct> products(@PathVariable String store) {
        StoreBillingProvider provider = requireProvider(store);
        return Arrays.stream(PlanSku.values())
                .map(sku -> new StoreProduct(sku.plan(), sku.band(), sku.interval(), provider.productIdFor(sku)))
                .toList();
    }

    /** What the app wants to buy, in the same symbols web checkout takes -- never a product id. */
    public record PrepareRequest(@NotNull BillingPlan plan, ClientBand band, @NotNull BillingInterval interval) {
    }

    public record PrepareResponse(String productId, UUID accountToken) {
    }

    /**
     * Asked before the store's purchase sheet opens. Refuses a household someone else is billing, and
     * claims the household for {@link #PURCHASE_CLAIM} so a second device cannot buy at the same time
     * (docs/in-app-purchase-plan.md, rules 1 and 2). Answers the product id and the household token the
     * app hands to the store.
     */
    @PostMapping("/api/billing/store/{store}/prepare")
    @RequiresPermission(Permission.MANAGE_BILLING)
    @Transactional
    public PrepareResponse prepare(@PathVariable String store, @Valid @RequestBody PrepareRequest request) {
        StoreBillingProvider provider = requireProvider(store);
        Long accountId = currentUser.accountId();
        if (!rateLimiter.tryConsumePerAccount(accountId)) {
            throw new TooManyRequestsException("Too many attempts. Try again shortly.");
        }

        PlanSku sku = PlanSku.of(request.plan(), request.band(), request.interval())
                .orElseThrow(() -> new IllegalArgumentException("That isn't a plan you can buy."));

        Subscription subscription = subscriptionService.getOrCreate(
                accountRepository.findById(accountId)
                        .orElseThrow(() -> new NotFoundException("We couldn't find that account.")));

        // Rule 1: one source at a time. Every refusal says where the plan IS managed, because that is
        // the only useful thing to tell somebody who already pays.
        if (subscriptionService.isEntitled(subscription)) {
            BillingSource billedBy = subscriptionService.isPaying(subscription)
                    ? subscriptionService.billingSource(subscription)
                    : null;
            throw new ConflictException(alreadyBilledMessage(billedBy, provider.source()));
        }

        // Rule 2: one purchase at a time. A conditional UPDATE, so two devices asking in the same
        // second cannot both win.
        Instant now = clock.instant();
        if (subscriptionRepository.claimStorePurchase(subscription.getId(), now, now.minus(PURCHASE_CLAIM)) != 1) {
            throw new ConflictException("A purchase is already in progress on another device. Finish it there,"
                    + " or try again in a few minutes.");
        }

        // Rule 4: the household's token, created once and kept forever. The store signs it into the
        // purchase and every renewal, which is how a store message finds this household later.
        if (subscription.getStoreAccountToken() == null) {
            subscription.setStoreAccountToken(UUID.randomUUID());
            subscriptionRepository.save(subscription);
        }

        String productId = provider.productIdFor(sku);
        auditService.record(accountId, BillingEventType.STORE_PURCHASE_STARTED,
                provider.source() + " sku=" + sku + " product=" + productId);
        return new PrepareResponse(productId, subscription.getStoreAccountToken());
    }

    /** The person closed the purchase sheet without buying: let another device start one now. */
    @PostMapping("/api/billing/store/{store}/release")
    @RequiresPermission(Permission.MANAGE_BILLING)
    @Transactional
    public ResponseEntity<Void> release(@PathVariable String store) {
        requireProvider(store);
        subscriptionService.findByAccountId(currentUser.accountId())
                .ifPresent(subscription -> subscriptionRepository.releaseStorePurchase(subscription.getId()));
        return ResponseEntity.noContent().build();
    }

    public record SyncRequest(@NotNull @Size(max = MAX_PROOFS) List<String> proofs) {
    }

    /**
     * The app sends the store's proof of every transaction it holds unfinished (a purchase just made,
     * a renewal, an Ask to Buy approved days later) or, on Restore Purchases, of every current one.
     *
     * <p>A 2xx means every proof was handled -- applied, ignored, or recorded as not ours -- and the app
     * may finish them. Anything else and it keeps them and sends them again: the store's own
     * transaction queue is the retry mechanism, so there is no second outbox for purchases.
     *
     * <p>Any member may call it, because the proof, not the caller, decides which household it is
     * applied to: a renewal can surface on any device signed in to the paying Apple ID.
     */
    @PostMapping("/api/billing/store/{store}/sync")
    @RequiresPermission(anyMember = true)
    public SubscriptionDto sync(@PathVariable String store, @Valid @RequestBody SyncRequest request) {
        StoreBillingProvider provider = requireProvider(store);
        Long accountId = currentUser.accountId();
        if (!rateLimiter.tryConsumePerAccount(accountId)) {
            throw new TooManyRequestsException("Too many attempts. Try again shortly.");
        }
        for (String proof : request.proofs()) {
            StorePurchaseReference reference;
            try {
                reference = provider.verifyPurchase(proof);
            } catch (StoreVerificationException e) {
                // Permanent: it will never verify. Recorded and skipped, so the app can finish it rather
                // than resend it forever.
                auditService.record(accountId, BillingEventType.STORE_REJECTED,
                        "sync: " + provider.source() + " proof did not verify: " + e.getMessage());
                continue;
            } catch (StoreBillingException e) {
                throw unavailable(e);
            }
            try {
                // An owner may adopt a purchase that names no household (bought outside the app);
                // StoreBillingService says exactly when. A member's device never adopts anything.
                Long claimant = currentUser.access().has(Permission.MANAGE_BILLING) ? accountId : null;
                storeBillingService.apply(provider, reference, "sync", claimant);
            } catch (StoreBillingException e) {
                throw unavailable(e);
            }
        }
        return subscriptionService.describe(accountId);
    }

    // Where the household's plan is managed, said plainly. For Stripe, plain text with NO link: a link
    // out of the app is a storefront question we don't need to answer (docs/in-app-purchase-plan.md).
    static String alreadyBilledMessage(BillingSource billedBy, BillingSource buyingIn) {
        if (billedBy == null) {
            return "This household already has a paid plan.";
        }
        if (billedBy == buyingIn) {
            return "This household's plan is billed through " + storeName(billedBy)
                    + ". To change it, use Manage subscription.";
        }
        return switch (billedBy) {
            case STRIPE -> "This household's plan is billed on huddle.fitness. Sign in there to change it.";
            case APP_STORE, GOOGLE_PLAY -> "This household's plan is billed through " + storeName(billedBy)
                    + ". Change it on a device that uses " + storeName(billedBy) + ".";
        };
    }

    private static String storeName(BillingSource source) {
        return switch (source) {
            case STRIPE -> "huddle.fitness";
            case APP_STORE -> "the App Store";
            case GOOGLE_PLAY -> "Google Play";
        };
    }

    private StoreBillingProvider requireProvider(String store) {
        StoreBillingProvider provider = BillingSource.storeFromPathSegment(store)
                .flatMap(providers::forSource)
                .orElseThrow(() -> new NotFoundException("Unknown store."));
        if (!provider.isConfigured()) {
            // Honest refusal, never a silent "Free": the same posture as unconfigured Stripe.
            throw new ServiceUnavailableException("In-app purchases are not available in this environment.");
        }
        return provider;
    }

    private static ServiceUnavailableException unavailable(StoreBillingException e) {
        log.error("Store unavailable during sync", e);
        return new ServiceUnavailableException("Could not confirm that purchase yet. It will appear shortly.");
    }
}
