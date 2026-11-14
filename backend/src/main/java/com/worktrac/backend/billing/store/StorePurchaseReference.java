package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingSource;

import java.util.UUID;

/**
 * Which store subscription a verified purchase or message is about: enough to find the household and
 * to ask the store for the subscription's current state. Never a statement of that state.
 *
 * @param accountToken the household token signed into the purchase, or null when it carries none
 * @param productId    the product the purchase or message names, for the audit trail only
 */
public record StorePurchaseReference(
        BillingSource source,
        String subscriptionId,
        StoreEnvironment environment,
        UUID accountToken,
        String productId) {
}
