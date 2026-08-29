package com.worktrac.backend.billing;

import com.stripe.model.Subscription;
import com.worktrac.backend.config.StripeProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

// Pins how a Stripe Subscription is narrowed into our own StripeSubscriptionState.
//
// This exists because of a real bug found against the sandbox: a household cancelled in the
// Customer Portal, Stripe's own screen said "Cancels Aug 28, 2027", and the app still said
// "Renews Aug 28, 2027". The cause was reading `cancel_at_period_end` alone -- which Stripe has
// DEPRECATED in favour of `cancel_at`, a timestamp the portal now sets instead.
//
// That is the failure mode worth guarding: a deprecated field does not throw or warn, it just
// quietly reports false forever. Nothing but a test notices. Note `current_period_end` moved off
// the subscription and onto its items in the same migration wave, so this is a pattern rather
// than a one-off.
class StripeSubscriptionStateTest {

    private StripeService stripeService;

    @BeforeEach
    void setUp() {
        stripeService = new StripeService(new StripeProperties());
    }

    private Subscription subscription(String status) {
        Subscription subscription = new Subscription();
        subscription.setId("sub_test");
        subscription.setCustomer("cus_test");
        subscription.setStatus(status);
        return subscription;
    }

    @Test
    void anOrdinarySubscriptionIsNotCancelling() {
        StripeSubscriptionState state = stripeService.toState(subscription("active"));

        assertThat(state.status()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(state.cancelAtPeriodEnd()).isFalse();
    }

    // The signal the Customer Portal actually sets today.
    @Test
    void aCancelAtTimestampMeansCancelling() {
        Subscription subscription = subscription("active");
        subscription.setCancelAt(Instant.parse("2027-08-28T23:01:43Z").getEpochSecond());

        StripeSubscriptionState state = stripeService.toState(subscription);

        assertThat(state.cancelAtPeriodEnd())
                .as("cancel_at is how Stripe expresses a scheduled cancellation now")
                .isTrue();
    }

    // The deprecated boolean still arrives from older integrations and from direct API calls, so
    // both readings have to work -- dropping either one reintroduces the bug from one direction.
    @Test
    void theLegacyBooleanStillMeansCancelling() {
        Subscription subscription = subscription("active");
        subscription.setCancelAtPeriodEnd(true);

        assertThat(stripeService.toState(subscription).cancelAtPeriodEnd()).isTrue();
    }

    // When Stripe names an explicit moment, that is when access actually stops -- so it is the date
    // the screen must show. Otherwise someone reads "Pro until" beside the wrong day.
    @Test
    void cancelAtBecomesTheDateServiceEnds() {
        Instant endsAt = Instant.parse("2027-08-28T23:01:43Z");
        Subscription subscription = subscription("active");
        subscription.setCancelAt(endsAt.getEpochSecond());

        assertThat(stripeService.toState(subscription).currentPeriodEnd()).isEqualTo(endsAt);
    }

    // An unrecognised status maps to INCOMPLETE rather than ACTIVE: guessing generously about a
    // state we do not understand gives Pro away.
    @Test
    void anUnknownStatusIsNotTreatedAsEntitled() {
        assertThat(stripeService.toState(subscription("some_future_status")).status())
                .isEqualTo(SubscriptionStatus.INCOMPLETE);
    }

    @Test
    void mapsEveryStatusWeActOn() {
        assertThat(stripeService.toState(subscription("active")).status()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(stripeService.toState(subscription("trialing")).status()).isEqualTo(SubscriptionStatus.TRIALING);
        assertThat(stripeService.toState(subscription("past_due")).status()).isEqualTo(SubscriptionStatus.PAST_DUE);
        assertThat(stripeService.toState(subscription("canceled")).status()).isEqualTo(SubscriptionStatus.CANCELED);
        assertThat(stripeService.toState(subscription("unpaid")).status()).isEqualTo(SubscriptionStatus.UNPAID);
    }
}
