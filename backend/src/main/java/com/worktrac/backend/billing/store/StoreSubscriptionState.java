package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingInterval;
import com.worktrac.backend.billing.BillingSource;
import com.worktrac.backend.billing.PlanSku;
import com.worktrac.backend.billing.SubscriptionStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * One store subscription, already mapped onto the columns this app stores -- the store-side twin of
 * {@code StripeSubscriptionState}, written by {@code SubscriptionService.applyStoreState}.
 *
 * <p>Always the store's CURRENT truth, read just now ({@link StoreBillingProvider#fetchState}), never
 * a message as delivered: stores do not guarantee ordering any more than Stripe does.
 *
 * @param subscriptionId the store's stable id (Apple: originalTransactionId)
 * @param productId      the store product currently billed
 * @param sku            what that product is, or null when this environment does not recognise it
 *                       (a config gap: the tier the row already has is kept)
 * @param environment    PRODUCTION or SANDBOX
 * @param accountToken   the household token the purchase was stamped with, or null if it had none
 */
public record StoreSubscriptionState(
        BillingSource source,
        String subscriptionId,
        String productId,
        PlanSku sku,
        SubscriptionStatus status,
        Instant currentPeriodEnd,
        boolean cancelAtPeriodEnd,
        StoreEnvironment environment,
        UUID accountToken) {

    public BillingInterval billingInterval() {
        return sku == null ? null : sku.interval();
    }

    public StorePurchaseReference reference() {
        return new StorePurchaseReference(source, subscriptionId, environment, accountToken, productId);
    }
}
