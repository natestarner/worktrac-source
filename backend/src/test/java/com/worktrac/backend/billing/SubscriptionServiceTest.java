package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

// The entitlement derivation is the highest-consequence logic in billing: it decides what a paying
// household can see, and getting it wrong in either direction is expensive (locking out a payer, or
// giving Pro away). It is pure logic over a Subscription plus the clock, so this is a plain unit
// test -- no Testcontainers, runs in the `unit` group in seconds.
//
// Deliberately a table of every case rather than a few happy paths. Each one below exists because
// the naive implementation (a stored is_pro flag, or `status == ACTIVE`) gets it wrong.
class SubscriptionServiceTest {

    private SubscriptionRepository repository;
    private MutableClock clock;
    private SubscriptionService service;
    private Account account;

    @BeforeEach
    void setUp() {
        repository = mock(SubscriptionRepository.class);
        clock = new MutableClock();
        service = new SubscriptionService(repository, clock);
        account = new Account("Test Household");
    }

    private Subscription subscription(SubscriptionStatus status) {
        Subscription subscription = new Subscription(account, clock.instant());
        subscription.setStatus(status);
        return subscription;
    }

    @Nested
    @DisplayName("statuses Stripe considers in good standing")
    class InGoodStanding {

        @Test
        void activeIsPro() {
            assertThat(service.isPro(subscription(SubscriptionStatus.ACTIVE))).isTrue();
        }

        // No trial ships today, but enabling one is a Dashboard setting rather than a code change.
        // If that ever happens, a trialing household must not be silently locked out.
        @Test
        void trialingIsPro() {
            assertThat(service.isPro(subscription(SubscriptionStatus.TRIALING))).isTrue();
        }

        // The one most likely to be "simplified" into a lockout. Stripe is still retrying the card
        // (Smart Retries); cutting access mid-dunning is how a recoverable payment failure turns
        // into a cancellation. They keep what they are paying for while the card is sorted out.
        @Test
        void pastDueIsStillPro() {
            assertThat(service.isPro(subscription(SubscriptionStatus.PAST_DUE))).isTrue();
        }
    }

    @Nested
    @DisplayName("cancelled: entitled until the period they paid for actually ends")
    class Cancelled {

        @Test
        void cancelledButInsidePaidPeriodIsPro() {
            Subscription subscription = subscription(SubscriptionStatus.CANCELED);
            subscription.setCurrentPeriodEnd(clock.instant().plus(Duration.ofDays(10)));

            assertThat(service.isPro(subscription)).isTrue();
        }

        // Expiry happens BY THE CLOCK -- no webhook is involved, and none is needed. This is the
        // property that makes a missed subscription.deleted harmless for a cancelled household.
        @Test
        void cancelledBecomesFreeWhenThePeriodElapses() {
            Subscription subscription = subscription(SubscriptionStatus.CANCELED);
            subscription.setCurrentPeriodEnd(clock.instant().plus(Duration.ofDays(10)));
            assertThat(service.isPro(subscription)).isTrue();

            clock.advance(Duration.ofDays(11));

            assertThat(service.isPro(subscription)).isFalse();
        }

        @Test
        void cancelledWithNoPeriodEndIsFree() {
            assertThat(service.isPro(subscription(SubscriptionStatus.CANCELED))).isFalse();
        }
    }

    @Nested
    @DisplayName("not entitled")
    class NotEntitled {

        @Test
        void freeIsNotPro() {
            assertThat(service.isPro(subscription(SubscriptionStatus.FREE))).isFalse();
        }

        // Checkout was started and abandoned. Intent is not payment.
        @Test
        void incompleteIsNotPro() {
            assertThat(service.isPro(subscription(SubscriptionStatus.INCOMPLETE))).isFalse();
        }

        @Test
        void unpaidIsNotPro() {
            assertThat(service.isPro(subscription(SubscriptionStatus.UNPAID))).isFalse();
        }
    }

    @Nested
    @DisplayName("comped")
    class Comped {

        // Comped grants Pro with no Stripe object at all, which is what lets founding households be
        // kept whole without distributing coupon codes or prompting for a card.
        @Test
        void compedIsProDespiteFreeStatus() {
            Subscription subscription = subscription(SubscriptionStatus.FREE);
            subscription.setComped(true);

            assertThat(service.isPro(subscription)).isTrue();
        }

        // A comp outlives a cancellation: someone who paid, cancelled, and was later comped is Pro.
        @Test
        void compedOutranksAnElapsedPeriod() {
            Subscription subscription = subscription(SubscriptionStatus.CANCELED);
            subscription.setCurrentPeriodEnd(clock.instant().minus(Duration.ofDays(30)));
            subscription.setComped(true);

            assertThat(service.isPro(subscription)).isTrue();
        }
    }

    @Nested
    @DisplayName("a household with no subscription row")
    class MissingRow {

        // Should be unreachable -- registration creates a row and V56 backfilled the rest -- but a
        // read of workout history must never fail because billing has no opinion about that
        // household yet. Free, not an exception.
        @Test
        void resolvesToFreeRatherThanThrowing() {
            when(repository.findByAccountId(any())).thenReturn(Optional.empty());

            assertThat(service.isPro(42L)).isFalse();
            assertThat(service.planFor(42L)).isEqualTo(BillingPlan.FREE);
            assertThat(service.describe(42L).plan()).isEqualTo(BillingPlan.FREE);
        }

        @Test
        void nullSubscriptionIsFree() {
            assertThat(service.isPro((Subscription) null)).isFalse();
        }
    }

    @Nested
    @DisplayName("planFor / describe agree with isPro")
    class DerivedViews {

        // These three must never be able to disagree: one derivation, three readers. A past-due
        // household is the case that catches a `status == ACTIVE` shortcut in any of them.
        @Test
        void pastDueReadsAsProEverywhere() {
            Subscription subscription = subscription(SubscriptionStatus.PAST_DUE);
            when(repository.findByAccountId(7L)).thenReturn(Optional.of(subscription));

            assertThat(service.isPro(7L)).isTrue();
            assertThat(service.planFor(7L)).isEqualTo(BillingPlan.PRO);

            SubscriptionDto dto = service.describe(7L);
            assertThat(dto.pro()).isTrue();
            assertThat(dto.plan()).isEqualTo(BillingPlan.PRO);
            // The raw status still travels, because the screen needs it to explain WHY.
            assertThat(dto.status()).isEqualTo(SubscriptionStatus.PAST_DUE);
        }
    }
}
