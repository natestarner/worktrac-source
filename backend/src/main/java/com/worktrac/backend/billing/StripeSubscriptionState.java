package com.worktrac.backend.billing;

import java.time.Instant;

// A snapshot of one Stripe subscription, already narrowed to the fields this app stores. Produced
// by StripeService (the only class that imports com.stripe.*) and consumed by
// SubscriptionService.applyStripeState.
//
// This type is the seam that keeps Stripe's SDK out of the rest of the backend -- the same job
// EmailService does for Azure Communication Services, and what makes billing integration tests
// possible with a @MockitoBean rather than an HTTP stub server (there is no WireMock here).
//
// It always represents state READ FROM STRIPE JUST NOW, never a webhook payload as delivered:
// Stripe does not guarantee event ordering, so applying a payload directly lets a stale
// subscription.updated overwrite a newer subscription.created.
public record StripeSubscriptionState(
        String stripeCustomerId,
        String stripeSubscriptionId,
        String stripePriceId,
        SubscriptionStatus status,
        BillingInterval billingInterval,
        Instant currentPeriodEnd,
        boolean cancelAtPeriodEnd) {

    // The shape a household falls back to when Stripe says the subscription is gone entirely.
    // Keeps the customer id: they may resubscribe, and reusing the existing Stripe Customer is what
    // stops a second one being created for the same household.
    public static StripeSubscriptionState canceledOutright(String stripeCustomerId) {
        return new StripeSubscriptionState(stripeCustomerId, null, null, SubscriptionStatus.CANCELED,
                null, null, false);
    }
}
