package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.billing.SubscriptionService.StoreApplyOutcome;
import com.worktrac.backend.billing.store.StoreEnvironment;
import com.worktrac.backend.billing.store.StoreSubscriptionState;
import com.worktrac.backend.config.StripeProperties;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// The one-source-at-a-time rule (docs/in-app-purchase-plan.md, "No overlapping subscriptions"):
// every row of it, against SubscriptionService directly. A plain unit test -- the rule is pure logic
// over a Subscription, a store state and the clock.
class StoreBillingRulesTest {

    private SubscriptionRepository repository;
    private MutableClock clock;
    private ApplicationEventPublisher events;
    private SubscriptionService service;
    private Account account;

    @BeforeEach
    void setUp() {
        repository = mock(SubscriptionRepository.class);
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(repository.claimPlusWelcome(any(), any())).thenReturn(1);
        clock = new MutableClock();
        events = mock(ApplicationEventPublisher.class);
        StripeProperties stripeProperties = new StripeProperties();
        stripeProperties.setPrices(new java.util.LinkedHashMap<>(java.util.Map.of(
                PlanSku.PLUS_MONTH.name(), "price_plus_month")));
        service = new SubscriptionService(repository, events, stripeProperties, mock(PersonRepository.class), clock);
        account = new Account("Store Household");
    }

    private Instant in(Duration duration) {
        return clock.instant().plus(duration);
    }

    private Subscription freeRow() {
        return new Subscription(account, clock.instant());
    }

    private Subscription stripePaying() {
        Subscription row = freeRow();
        row.setBillingSource(BillingSource.STRIPE);
        row.setStripeSubscriptionId("sub_web");
        row.setStripePriceId("price_plus_month");
        row.setStatus(SubscriptionStatus.ACTIVE);
        row.setPlan(BillingPlan.PLUS);
        row.setCurrentPeriodEnd(in(Duration.ofDays(20)));
        return row;
    }

    private Subscription appStorePaying(String originalTransactionId) {
        Subscription row = freeRow();
        row.setBillingSource(BillingSource.APP_STORE);
        row.setStoreSubscriptionId(originalTransactionId);
        row.setStatus(SubscriptionStatus.ACTIVE);
        row.setPlan(BillingPlan.PLUS);
        row.setCurrentPeriodEnd(in(Duration.ofDays(20)));
        return row;
    }

    private StoreSubscriptionState apple(String id, PlanSku sku, SubscriptionStatus status, Instant end) {
        return new StoreSubscriptionState(BillingSource.APP_STORE, id, "huddle." + sku, sku, status, end, false,
                StoreEnvironment.SANDBOX, UUID.randomUUID());
    }

    private StoreSubscriptionState google(String id, SubscriptionStatus status) {
        return new StoreSubscriptionState(BillingSource.GOOGLE_PLAY, id, "huddle.plus.year", PlanSku.PLUS_YEAR,
                status, in(Duration.ofDays(300)), false, StoreEnvironment.PRODUCTION, UUID.randomUUID());
    }

    private List<BillingOverlapEvent> overlaps() {
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(events, atLeast(0)).publishEvent(captor.capture());
        return captor.getAllValues().stream()
                .filter(BillingOverlapEvent.class::isInstance)
                .map(BillingOverlapEvent.class::cast)
                .toList();
    }

    @Nested
    class AFirstPurchase {

        @Test
        void isWrittenWithItsTierSourceAndEnvironment() {
            Subscription row = freeRow();
            StoreSubscriptionState state = apple("1000", PlanSku.PRO_STUDIO_YEAR, SubscriptionStatus.ACTIVE,
                    in(Duration.ofDays(365)));

            assertThat(service.applyStoreState(row, state)).isEqualTo(StoreApplyOutcome.APPLIED);

            assertThat(row.getBillingSource()).isEqualTo(BillingSource.APP_STORE);
            assertThat(row.getStoreSubscriptionId()).isEqualTo("1000");
            assertThat(row.getStoreEnvironment()).isEqualTo(StoreEnvironment.SANDBOX);
            assertThat(row.getStoreAccountToken()).isEqualTo(state.accountToken());
            assertThat(service.entitledPlan(row)).isEqualTo(BillingPlan.PRO);
            assertThat(row.getClientSeats()).isEqualTo(ClientBand.STUDIO.clientLimit());
            assertThat(row.getBillingInterval()).isEqualTo(BillingInterval.YEAR);
        }

        // A store purchase is a purchase: member logins unpause and the welcome email goes out,
        // exactly as after a Stripe checkout.
        @Test
        void publishesThePlanChangeAndTheWelcomeLikeAStripeCheckout() {
            service.applyStoreState(freeRow(), apple("1000", PlanSku.PLUS_MONTH, SubscriptionStatus.ACTIVE,
                    in(Duration.ofDays(30))));

            verify(events).publishEvent(any(AccountPlanChangedEvent.class));
            verify(events).publishEvent(any(PlusUpgradedEvent.class));
        }

        @Test
        void releasesTheOnePurchaseAtATimeClaim() {
            Subscription row = freeRow();
            service.applyStoreState(row, apple("1000", PlanSku.PLUS_MONTH, SubscriptionStatus.ACTIVE,
                    in(Duration.ofDays(30))));
            verify(repository).releaseStorePurchase(row.getId());
        }

        // The household's token is its own; a purchase never replaces it (two households could then
        // claim one token).
        @Test
        void neverReplacesTheHouseholdsToken() {
            Subscription row = freeRow();
            UUID own = UUID.randomUUID();
            row.setStoreAccountToken(own);
            service.applyStoreState(row, apple("1000", PlanSku.PLUS_MONTH, SubscriptionStatus.ACTIVE,
                    in(Duration.ofDays(30))));
            assertThat(row.getStoreAccountToken()).isEqualTo(own);
        }
    }

    @Nested
    class TheSameSubscriptionChanging {

        @Test
        void aRenewalMovesThePeriodEnd() {
            Subscription row = appStorePaying("1000");
            Instant renewed = in(Duration.ofDays(50));
            service.applyStoreState(row, apple("1000", PlanSku.PLUS_MONTH, SubscriptionStatus.ACTIVE, renewed));
            assertThat(row.getCurrentPeriodEnd()).isEqualTo(renewed);
        }

        // An upgrade inside the subscription group keeps the same original transaction id.
        @Test
        void anUpgradeToProChangesTheTier() {
            Subscription row = appStorePaying("1000");
            service.applyStoreState(row, apple("1000", PlanSku.PRO_PRACTICE_MONTH, SubscriptionStatus.ACTIVE,
                    in(Duration.ofDays(30))));
            assertThat(service.entitledPlan(row)).isEqualTo(BillingPlan.PRO);
            assertThat(row.getClientSeats()).isEqualTo(ClientBand.PRACTICE.clientLimit());
        }

        @Test
        void expiryEndsThePlan() {
            Subscription row = appStorePaying("1000");
            StoreApplyOutcome outcome = service.applyStoreState(row, apple("1000", PlanSku.PLUS_MONTH,
                    SubscriptionStatus.CANCELED, clock.instant().minusSeconds(60)));
            assertThat(outcome).isEqualTo(StoreApplyOutcome.APPLIED);
            assertThat(service.entitledPlan(row)).isEqualTo(BillingPlan.FREE);
        }

        // An unknown product is a config gap on our side, not evidence: keep the tier.
        @Test
        void anUnknownProductKeepsTheTier() {
            Subscription row = appStorePaying("1000");
            row.setPlan(BillingPlan.PRO);
            StoreSubscriptionState unknown = new StoreSubscriptionState(BillingSource.APP_STORE, "1000",
                    "huddle.something.new", null, SubscriptionStatus.ACTIVE, in(Duration.ofDays(30)), false,
                    StoreEnvironment.PRODUCTION, null);
            service.applyStoreState(row, unknown);
            assertThat(service.entitledPlan(row)).isEqualTo(BillingPlan.PRO);
        }
    }

    @Nested
    class SomethingElseIsPaying {

        // Rule 5: Apple cannot be cancelled by us, Stripe can -- Apple stays, Stripe is refunded.
        @Test
        void anAppStorePurchaseOverStripeWinsAndStripeIsRefunded() {
            Subscription row = stripePaying();
            StoreApplyOutcome outcome = service.applyStoreState(row, apple("1000", PlanSku.PLUS_YEAR,
                    SubscriptionStatus.ACTIVE, in(Duration.ofDays(365))));

            assertThat(outcome).isEqualTo(StoreApplyOutcome.OVERLAP_RESOLVED);
            assertThat(row.getBillingSource()).isEqualTo(BillingSource.APP_STORE);
            assertThat(overlaps()).singleElement().satisfies(overlap -> {
                assertThat(overlap.loser()).isEqualTo(BillingSource.STRIPE);
                assertThat(overlap.loserSubscriptionId()).isEqualTo("sub_web");
                assertThat(overlap.keeper()).isEqualTo(BillingSource.APP_STORE);
                assertThat(overlap.uncancellable()).isFalse();
            });
        }

        // The mirror: a Stripe checkout that finishes after an App Store purchase never writes the
        // row; Stripe is cancelled and refunded.
        @Test
        void aStripeSubscriptionTurningUpUnderAnAppStoreHouseholdIsRefundedNotWritten() {
            Subscription row = appStorePaying("1000");
            service.applyStripeState(row, new StripeSubscriptionState("cus_1", "sub_late", "price_plus_month",
                    SubscriptionStatus.ACTIVE, BillingInterval.MONTH, in(Duration.ofDays(30)), false));

            assertThat(row.getBillingSource()).isEqualTo(BillingSource.APP_STORE);
            assertThat(row.getStripeSubscriptionId()).isNull();
            assertThat(overlaps()).singleElement().satisfies(overlap -> {
                assertThat(overlap.loser()).isEqualTo(BillingSource.STRIPE);
                assertThat(overlap.loserSubscriptionId()).isEqualTo("sub_late");
            });
        }

        // An old, cancelled Stripe subscription's late webhook must not write CANCELED over a
        // paying App Store household.
        @Test
        void aLapsedStripeSubscriptionsWebhookLeavesAnAppStoreHouseholdAlone() {
            Subscription row = appStorePaying("1000");
            service.applyStripeState(row, StripeSubscriptionState.canceledOutright("cus_1"));

            assertThat(row.getStatus()).isEqualTo(SubscriptionStatus.ACTIVE);
            assertThat(service.entitledPlan(row)).isEqualTo(BillingPlan.PLUS);
            assertThat(overlaps()).isEmpty();
        }

        // Two Apple IDs: neither can be cancelled by us. Keep the one already billing, tell people.
        @Test
        void twoAppStoreSubscriptionsKeepTheFirstAndRaiseTheAlarm() {
            Subscription row = appStorePaying("1000");
            StoreApplyOutcome outcome = service.applyStoreState(row, apple("2000", PlanSku.PLUS_MONTH,
                    SubscriptionStatus.ACTIVE, in(Duration.ofDays(30))));

            assertThat(outcome).isEqualTo(StoreApplyOutcome.OVERLAP_UNCANCELLABLE);
            assertThat(row.getStoreSubscriptionId()).isEqualTo("1000");
            assertThat(overlaps()).singleElement().satisfies(overlap -> {
                assertThat(overlap.uncancellable()).isTrue();
                assertThat(overlap.keeperSubscriptionId()).isEqualTo("1000");
                assertThat(overlap.loserSubscriptionId()).isEqualTo("2000");
            });
        }

        // Android later: Apple stays, Google (cancellable) is refunded -- with no new rule.
        @Test
        void googlePlayOverAnAppStoreHouseholdIsTheOneRefunded() {
            Subscription row = appStorePaying("1000");
            service.applyStoreState(row, google("gp-token", SubscriptionStatus.ACTIVE));

            assertThat(row.getBillingSource()).isEqualTo(BillingSource.APP_STORE);
            assertThat(overlaps()).singleElement().satisfies(overlap -> {
                assertThat(overlap.loser()).isEqualTo(BillingSource.GOOGLE_PLAY);
                assertThat(overlap.loserSubscriptionId()).isEqualTo("gp-token");
            });
        }

        // Both cancellable: never flip-flop a working household; the newcomer is refunded.
        @Test
        void googlePlayOverStripeKeepsStripeAndRefundsGoogle() {
            Subscription row = stripePaying();
            service.applyStoreState(row, google("gp-token", SubscriptionStatus.ACTIVE));

            assertThat(row.getBillingSource()).isEqualTo(BillingSource.STRIPE);
            assertThat(overlaps()).singleElement()
                    .satisfies(overlap -> assertThat(overlap.loser()).isEqualTo(BillingSource.GOOGLE_PLAY));
        }

        // A lapsed subscription from elsewhere is not an overlap -- it isn't paying.
        @Test
        void aNonPayingStateAboutAnotherSubscriptionIsIgnored() {
            Subscription row = stripePaying();
            StoreApplyOutcome outcome = service.applyStoreState(row, apple("1000", PlanSku.PLUS_MONTH,
                    SubscriptionStatus.CANCELED, clock.instant().minusSeconds(60)));

            assertThat(outcome).isEqualTo(StoreApplyOutcome.IGNORED_NOT_CURRENT);
            assertThat(row.getBillingSource()).isEqualTo(BillingSource.STRIPE);
            assertThat(overlaps()).isEmpty();
        }
    }

    @Nested
    class SwitchingSides {

        // Cancelled on Apple and let it run out; then buying on the web is just a purchase.
        @Test
        void stripeTakesOverOnceTheAppStorePeriodHasEnded() {
            Subscription row = appStorePaying("1000");
            row.setStatus(SubscriptionStatus.CANCELED);
            row.setCurrentPeriodEnd(clock.instant().minusSeconds(60));

            service.applyStripeState(row, new StripeSubscriptionState("cus_1", "sub_web", "price_plus_month",
                    SubscriptionStatus.ACTIVE, BillingInterval.MONTH, in(Duration.ofDays(30)), false));

            assertThat(row.getBillingSource()).isEqualTo(BillingSource.STRIPE);
            assertThat(service.entitledPlan(row)).isEqualTo(BillingPlan.PLUS);
            assertThat(overlaps()).isEmpty();
        }

        // "Still billed" includes cancelled-but-paid-through: no overlap is resolved by writing over it.
        @Test
        void aCancelledButPaidThroughAppStoreRowStillCountsAsBilling() {
            Subscription row = appStorePaying("1000");
            row.setStatus(SubscriptionStatus.CANCELED);
            row.setCancelAtPeriodEnd(false);

            service.applyStripeState(row, new StripeSubscriptionState("cus_1", "sub_web", "price_plus_month",
                    SubscriptionStatus.ACTIVE, BillingInterval.MONTH, in(Duration.ofDays(30)), false));

            assertThat(row.getBillingSource()).isEqualTo(BillingSource.APP_STORE);
            assertThat(overlaps()).singleElement()
                    .satisfies(overlap -> assertThat(overlap.loser()).isEqualTo(BillingSource.STRIPE));
        }
    }

    @Test
    void theSourceOfARowStripeBilledBeforeTheColumnExistedIsStripe() {
        Subscription row = freeRow();
        row.setStripeSubscriptionId("sub_old");
        assertThat(service.billingSource(row)).isEqualTo(BillingSource.STRIPE);
        assertThat(service.billingSource(freeRow())).isNull();
    }

    @Test
    void theScreenIsToldWhoBillsOnlyWhileSomeoneIsPaying() {
        Subscription paying = appStorePaying("1000");
        when(repository.findByAccountId(any())).thenReturn(java.util.Optional.of(paying));
        assertThat(service.describe(1L).billingSource()).isEqualTo(BillingSource.APP_STORE);

        paying.setStatus(SubscriptionStatus.CANCELED);
        paying.setCurrentPeriodEnd(clock.instant().minusSeconds(1));
        assertThat(service.describe(1L).billingSource()).isNull();
    }
}
