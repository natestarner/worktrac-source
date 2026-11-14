package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingAuditService;
import com.worktrac.backend.billing.BillingEventType;
import com.worktrac.backend.billing.Subscription;
import com.worktrac.backend.billing.SubscriptionRepository;
import com.worktrac.backend.billing.SubscriptionService;
import com.worktrac.backend.billing.SubscriptionService.StoreApplyOutcome;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Optional;

/**
 * The one path from "a store told us something about a subscription" to the household's row, shared
 * by the app's sync, the store's notifications and the reconciliation watchdog -- three callers, one
 * path, so they can never disagree about what a store state means (the reason applyStripeState has
 * one writer too).
 *
 * <p>Re-fetch, attribute, apply:
 * <ol>
 *   <li>The store is asked for the subscription's CURRENT state. A message's own claims are never
 *       written, so late and out-of-order messages cannot do damage.</li>
 *   <li>The household is found by the store's subscription id first, then by the household token
 *       signed into the purchase -- never by whoever is signed in on the phone that sent it.</li>
 *   <li>{@link SubscriptionService#applyStoreState} writes it, under the one-source-at-a-time rule.</li>
 * </ol>
 */
@Service
public class StoreBillingService {

    private static final Logger log = LoggerFactory.getLogger(StoreBillingService.class);

    private final SubscriptionRepository subscriptionRepository;
    private final SubscriptionService subscriptionService;
    private final BillingAuditService auditService;
    private final TransactionTemplate transaction;

    public StoreBillingService(SubscriptionRepository subscriptionRepository, SubscriptionService subscriptionService,
                               BillingAuditService auditService, PlatformTransactionManager transactionManager) {
        this.subscriptionRepository = subscriptionRepository;
        this.subscriptionService = subscriptionService;
        this.auditService = auditService;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /** What happened to one reference, for the caller (and the app's sync response). */
    public enum Result {
        APPLIED, IGNORED, OVERLAP_RESOLVED, OVERLAP_UNCANCELLABLE, UNMATCHED
    }

    /**
     * Re-fetches and applies one store subscription.
     *
     * @throws StoreBillingException the store could not be reached: the caller answers 503 so the app
     *                               (or the store) sends it again
     */
    public Result apply(StoreBillingProvider provider, StorePurchaseReference reference, String via)
            throws StoreBillingException {
        // Outside any transaction: no database connection is held while the store answers.
        StoreSubscriptionState state = provider.fetchState(reference);
        Applied applied = transaction.execute(status -> attributeAndApply(state, reference, via));
        if (applied.outcome() == StoreApplyOutcome.APPLIED) {
            provider.acknowledge(state.reference());
        }
        return applied.result();
    }

    private record Applied(Result result, StoreApplyOutcome outcome) {
    }

    // One transaction: the attribution read and the write, so the row cannot change between them.
    private Applied attributeAndApply(StoreSubscriptionState state, StorePurchaseReference reference, String via) {

        // The token as Apple holds it now beats the one in what we were sent: Set App Account Token
        // can stamp a purchase after the fact, and the re-fetched state carries the result.
        java.util.UUID token = state.accountToken() != null ? state.accountToken() : reference.accountToken();
        Optional<Subscription> household = findHousehold(state.subscriptionId(), token);
        if (household.isEmpty()) {
            auditService.record(null, BillingEventType.STORE_UNMATCHED,
                    via + ": " + state.source() + " " + state.subscriptionId() + " (" + state.productId() + ", "
                            + state.status() + ", " + state.environment() + ", token "
                            + (token == null ? "none" : token) + ") names no household. Not applied.");
            log.warn("Unmatched {} subscription {} via {}", state.source(), state.subscriptionId(), via);
            return new Applied(Result.UNMATCHED, null);
        }

        Subscription subscription = household.get();
        StoreApplyOutcome outcome = subscriptionService.applyStoreState(subscription, state);
        Long accountId = subscription.getAccount().getId();
        String detail = via + ": " + state.source() + " " + state.subscriptionId() + " " + state.productId()
                + " status=" + state.status() + " until=" + state.currentPeriodEnd()
                + (state.cancelAtPeriodEnd() ? " (ends)" : "") + " env=" + state.environment()
                + (state.sku() == null ? " UNKNOWN PRODUCT (tier kept)" : "") + " -> " + outcome;
        auditService.record(accountId,
                outcome == StoreApplyOutcome.IGNORED_NOT_CURRENT ? BillingEventType.STORE_REJECTED
                        : BillingEventType.STORE_APPLIED,
                detail);
        Result result = switch (outcome) {
            case APPLIED -> Result.APPLIED;
            case IGNORED_NOT_CURRENT -> Result.IGNORED;
            case OVERLAP_RESOLVED -> Result.OVERLAP_RESOLVED;
            case OVERLAP_UNCANCELLABLE -> Result.OVERLAP_UNCANCELLABLE;
        };
        return new Applied(result, outcome);
    }

    // Subscription id first: a household that already knows this subscription is its owner, whatever
    // token a later purchase carried. Several rows can only share one if a household lapsed and another
    // somehow adopted it; prefer the one it is currently paying.
    private Optional<Subscription> findHousehold(String storeSubscriptionId, java.util.UUID token) {
        List<Subscription> byId = storeSubscriptionId == null
                ? List.of()
                : subscriptionRepository.findByStoreSubscriptionId(storeSubscriptionId);
        if (!byId.isEmpty()) {
            return byId.stream().filter(subscriptionService::isPaying).findFirst()
                    .or(() -> Optional.of(byId.getFirst()));
        }
        return token == null ? Optional.empty() : subscriptionRepository.findByStoreAccountToken(token);
    }
}
