package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingSource;
import com.worktrac.backend.billing.PlanSku;

import java.util.Optional;

/**
 * Everything one app store must do for billing. Apple's is {@code appstore.AppStoreProvider}; Google
 * Play's goes beside it later and changes nothing else (docs/in-app-purchase-plan.md, "Android
 * later").
 *
 * <p>⚠️ Each provider is the ONLY class that imports its store's SDK, the rule StripeService already
 * follows for Stripe. That is what lets everything above this interface be tested with a fake.
 *
 * <p>Whether we can cancel a subscription is NOT here: it is {@link BillingSource#weCanCancel()}, so
 * the overlap rule reads the same for every pair of sources, Stripe included.
 */
public interface StoreBillingProvider {

    BillingSource source();

    /** Whether this environment has the credentials to talk to this store. Unconfigured answers 503. */
    boolean isConfigured();

    /** The store product id for a SKU in THIS environment (e.g. {@code huddle.plus.year}). */
    String productIdFor(PlanSku sku);

    /** The reverse: which SKU a product id is, or empty for one this environment doesn't sell. */
    Optional<PlanSku> skuForProductId(String productId);

    /**
     * Verifies what the app sent after a purchase or restore (Apple: the transaction's signed JWS;
     * Google: the purchase token) and says which subscription it is about.
     */
    StorePurchaseReference verifyPurchase(String proof) throws StoreVerificationException, StoreBillingException;

    /**
     * Verifies a store-to-server message and says which subscription changed. Empty for a genuine
     * message about no subscription (Apple's TEST notification). The message's own claims about state
     * are never used: the caller re-fetches with {@link #fetchState}.
     */
    Optional<StorePurchaseReference> parseNotification(String body)
            throws StoreVerificationException, StoreBillingException;

    /**
     * Subscriptions named by store messages that FAILED to reach us since {@code since} -- the store's
     * own record of what it could not deliver (Apple: Get Notification History with onlyFailures).
     * Apple's recommended recovery from an outage, and the only one for its sandbox, which sends each
     * notification once and never retries. A store that redelivers on its own answers empty.
     */
    default java.util.List<StorePurchaseReference> undeliveredSince(java.time.Instant since) throws StoreBillingException {
        return java.util.List.of();
    }

    /** The store's current truth about one subscription, read now. */
    StoreSubscriptionState fetchState(StorePurchaseReference reference) throws StoreBillingException;

    /**
     * Cancels the subscription and refunds its latest payment in full, answering a line for the audit
     * trail. Only ever called for a source whose {@link BillingSource#weCanCancel()} is true.
     */
    String cancelAndRefund(StorePurchaseReference reference) throws StoreBillingException;

    /**
     * Writes the household token onto a purchase that was made without one, so the store returns it on
     * every renewal from now on (Apple: Set App Account Token). A store that can't do this after the
     * fact does nothing: the household still finds the purchase by its subscription id.
     */
    default void stampAccountToken(StorePurchaseReference reference, java.util.UUID accountToken)
            throws StoreBillingException {
    }

    /** Anything the store needs once we have accepted a purchase (Google: acknowledge within 3 days). */
    void acknowledge(StorePurchaseReference reference) throws StoreBillingException;
}
