package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.config.StripeProperties;
import com.worktrac.backend.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Nested;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Duration;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// The entitlement derivation is the highest-consequence logic in billing: it decides what a paying
// household can see, and getting it wrong in either direction is expensive (locking out a payer, or
// giving Plus away). It is pure logic over a Subscription plus the clock, so this is a plain unit
// test -- no Testcontainers, runs in the `unit` group in seconds.
//
// Deliberately a table of every case rather than a few happy paths. Each one below exists because
// the naive implementation (a stored is_plus flag, or `status == ACTIVE`) gets it wrong.
class SubscriptionServiceTest {

    private static final String PLUS_MONTH_PRICE = "price_plus_month";
    private static final String PLUS_YEAR_PRICE = "price_plus_year";
    private static final String PRO_STUDIO_YEAR_PRICE = "price_pro_studio_year";

    private SubscriptionRepository repository;
    private MutableClock clock;
    private ApplicationEventPublisher events;
    private StripeProperties stripeProperties;
    private SubscriptionService service;
    private Account account;

    @BeforeEach
    void setUp() {
        repository = mock(SubscriptionRepository.class);
        // save() echoes back whatever it was given -- applyStripeState reads the id and account off
        // its return value, so a bare mock() (which defaults to null) would NPE there.
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        clock = new MutableClock();
        events = mock(ApplicationEventPublisher.class);
        // A real StripeProperties with a real price map, not a mock: applyStripeState now derives
        // the tier from the price id, so a mock returning empty would make every test assert the
        // "unrecognised price" branch while looking like it asserted the normal one.
        stripeProperties = new StripeProperties();
        stripeProperties.setPrices(new java.util.LinkedHashMap<>(java.util.Map.of(
                PlanSku.PLUS_MONTH.name(), PLUS_MONTH_PRICE,
                PlanSku.PLUS_YEAR.name(), PLUS_YEAR_PRICE,
                PlanSku.PRO_STUDIO_YEAR.name(), PRO_STUDIO_YEAR_PRICE)));
        service = new SubscriptionService(repository, events, stripeProperties, clock);
        account = new Account("Test Household");
    }

    private Subscription subscription(SubscriptionStatus status) {
        Subscription subscription = new Subscription(account, clock.instant());
        subscription.setStatus(status);
        return subscription;
    }

    // A row whose recorded tier is set, the way applyStripeState always leaves one. The overload
    // above leaves plan at its FREE default, which for an ENTITLED status is the contradiction
    // entitledPlan falls back on -- fine for the derivation tests, wrong for anything asserting a
    // tier, because it would pass identically if the recorded tier were ignored entirely.
    private Subscription subscription(SubscriptionStatus status, BillingPlan plan) {
        Subscription subscription = subscription(status);
        subscription.setPlan(plan);
        return subscription;
    }

    @Nested
    @DisplayName("statuses Stripe considers in good standing")
    class InGoodStanding {

        @Test
        void activeIsEntitled() {
            assertThat(service.isEntitled(subscription(SubscriptionStatus.ACTIVE))).isTrue();
        }

        // No trial ships today, but enabling one is a Dashboard setting rather than a code change.
        // If that ever happens, a trialing household must not be silently locked out.
        @Test
        void trialingIsEntitled() {
            assertThat(service.isEntitled(subscription(SubscriptionStatus.TRIALING))).isTrue();
        }

        // The one most likely to be "simplified" into a lockout. Stripe is still retrying the card
        // (Smart Retries); cutting access mid-dunning is how a recoverable payment failure turns
        // into a cancellation. They keep what they are paying for while the card is sorted out.
        @Test
        void pastDueIsStillEntitled() {
            assertThat(service.isEntitled(subscription(SubscriptionStatus.PAST_DUE))).isTrue();
        }
    }

    @Nested
    @DisplayName("cancelled: entitled until the period they paid for actually ends")
    class Cancelled {

        @Test
        void cancelledButInsidePaidPeriodIsEntitled() {
            Subscription subscription = subscription(SubscriptionStatus.CANCELED);
            subscription.setCurrentPeriodEnd(clock.instant().plus(Duration.ofDays(10)));

            assertThat(service.isEntitled(subscription)).isTrue();
        }

        // Expiry happens BY THE CLOCK -- no webhook is involved, and none is needed. This is the
        // property that makes a missed subscription.deleted harmless for a cancelled household.
        @Test
        void cancelledBecomesFreeWhenThePeriodElapses() {
            Subscription subscription = subscription(SubscriptionStatus.CANCELED);
            subscription.setCurrentPeriodEnd(clock.instant().plus(Duration.ofDays(10)));
            assertThat(service.isEntitled(subscription)).isTrue();

            clock.advance(Duration.ofDays(11));

            assertThat(service.isEntitled(subscription)).isFalse();
        }

        @Test
        void cancelledWithNoPeriodEndIsFree() {
            assertThat(service.isEntitled(subscription(SubscriptionStatus.CANCELED))).isFalse();
        }
    }

    @Nested
    @DisplayName("not entitled")
    class NotEntitled {

        @Test
        void freeIsNotEntitled() {
            assertThat(service.isEntitled(subscription(SubscriptionStatus.FREE))).isFalse();
        }

        // Checkout was started and abandoned. Intent is not payment.
        @Test
        void incompleteIsNotEntitled() {
            assertThat(service.isEntitled(subscription(SubscriptionStatus.INCOMPLETE))).isFalse();
        }

        @Test
        void unpaidIsNotEntitled() {
            assertThat(service.isEntitled(subscription(SubscriptionStatus.UNPAID))).isFalse();
        }
    }

    @Nested
    @DisplayName("the tier comes from the PRICE, never from the fact of paying")
    class PurchasedTier {

        private StripeSubscriptionState state(String priceId, SubscriptionStatus status) {
            return new StripeSubscriptionState("cus_1", "sub_1", priceId, status,
                    BillingInterval.YEAR, clock.instant().plus(Duration.ofDays(30)), false);
        }

        // With one paid tier, "entitled" and "Plus" were the same thing. With two they are not, and
        // this is the assertion that stops a future `isEntitled ? PLUS : FREE` from silently
        // writing PLUS over somebody's Pro subscription on the very next webhook.
        @Test
        void aProPriceWritesProAndItsSeats() {
            Subscription subscription = subscription(SubscriptionStatus.FREE);

            service.applyStripeState(subscription, state(PRO_STUDIO_YEAR_PRICE, SubscriptionStatus.ACTIVE));

            assertThat(subscription.getPlan()).isEqualTo(BillingPlan.PRO);
            assertThat(subscription.getClientSeats()).isEqualTo(ClientBand.STUDIO.clientLimit());
            assertThat(service.entitledPlan(subscription)).isEqualTo(BillingPlan.PRO);
        }

        @Test
        void aPlusPriceWritesPlusAndNoSeats() {
            Subscription subscription = subscription(SubscriptionStatus.FREE);

            service.applyStripeState(subscription, state(PLUS_YEAR_PRICE, SubscriptionStatus.ACTIVE));

            assertThat(subscription.getPlan()).isEqualTo(BillingPlan.PLUS);
            assertThat(subscription.getClientSeats()).isNull();
        }

        // A price we cannot map is a CONFIG gap on our side -- an env var not carried to this
        // environment -- and it is not evidence about what the household bought. Downgrading a
        // paying Pro trainer to Plus over a missing env var would be the worst reading of it, and
        // it would re-inflict itself on every webhook until somebody noticed.
        @Test
        void anUnrecognisedPriceKeepsTheTierRatherThanGuessing() {
            Subscription subscription = subscription(SubscriptionStatus.ACTIVE, BillingPlan.PRO);
            subscription.setClientSeats(ClientBand.STUDIO.clientLimit());

            service.applyStripeState(subscription,
                    state("price_from_an_unconfigured_environment", SubscriptionStatus.ACTIVE));

            assertThat(subscription.getPlan()).isEqualTo(BillingPlan.PRO);
            assertThat(subscription.getClientSeats()).isEqualTo(ClientBand.STUDIO.clientLimit());
        }

        // A lapse clears the seats as well as the tier. Leaving them behind would hand a Free
        // account a roster allowance it is no longer paying for, the next time anything read them.
        @Test
        void lapsingClearsTheTierAndTheSeats() {
            Subscription subscription = subscription(SubscriptionStatus.ACTIVE, BillingPlan.PRO);
            subscription.setClientSeats(ClientBand.STUDIO.clientLimit());

            service.applyStripeState(subscription, new StripeSubscriptionState("cus_1", "sub_1",
                    PRO_STUDIO_YEAR_PRICE, SubscriptionStatus.UNPAID, BillingInterval.YEAR, null, false));

            assertThat(subscription.getPlan()).isEqualTo(BillingPlan.FREE);
            assertThat(subscription.getClientSeats()).isNull();
        }

        // entitlementOf is what AccountAccessService caches, and it must not report seats for a
        // tier that is no longer in force even though the row still records the band it bought.
        @Test
        void entitlementOfReportsNoSeatsOnceTheTierLapses() {
            Subscription subscription = subscription(SubscriptionStatus.UNPAID, BillingPlan.PRO);
            subscription.setClientSeats(ClientBand.STUDIO.clientLimit());
            when(repository.findByAccountId(9L)).thenReturn(Optional.of(subscription));

            assertThat(service.entitlementOf(9L).plan()).isEqualTo(BillingPlan.FREE);
            assertThat(service.entitlementOf(9L).clientSeats()).isNull();
        }

        // A comp's tier comes from comped_plan, not from billing_plan, because billing_plan is a
        // cache applyStripeState rewrites on every Stripe event while a comp is a standing grant.
        @Test
        void aCompGrantsTheTierTheCompNames() {
            Subscription subscription = subscription(SubscriptionStatus.FREE, BillingPlan.FREE);
            subscription.setComped(true);
            subscription.setCompedPlan(BillingPlan.PRO);

            assertThat(service.entitledPlan(subscription)).isEqualTo(BillingPlan.PRO);
        }

        // Null comped_plan means PLUS: it is what every comp granted before Pro existed, which is
        // why V75 needed no backfill.
        @Test
        void aCompWithNoRecordedTierStillMeansPlus() {
            Subscription subscription = subscription(SubscriptionStatus.FREE, BillingPlan.FREE);
            subscription.setComped(true);

            assertThat(service.entitledPlan(subscription)).isEqualTo(BillingPlan.PLUS);
        }
    }

    @Nested
    @DisplayName("comped")
    class Comped {

        // Comped grants Plus with no Stripe object at all, which is what lets founding households be
        // kept whole without distributing coupon codes or prompting for a card.
        @Test
        void compedIsPlusDespiteFreeStatus() {
            Subscription subscription = subscription(SubscriptionStatus.FREE);
            subscription.setComped(true);

            assertThat(service.isEntitled(subscription)).isTrue();
        }

        // A comp outlives a cancellation: someone who paid, cancelled, and was later comped is Plus.
        @Test
        void compedOutranksAnElapsedPeriod() {
            Subscription subscription = subscription(SubscriptionStatus.CANCELED);
            subscription.setCurrentPeriodEnd(clock.instant().minus(Duration.ofDays(30)));
            subscription.setComped(true);

            assertThat(service.isEntitled(subscription)).isTrue();
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

            assertThat(service.isEntitled(42L)).isFalse();
            assertThat(service.entitledPlan(42L)).isEqualTo(BillingPlan.FREE);
            assertThat(service.describe(42L).plan()).isEqualTo(BillingPlan.FREE);
        }

        @Test
        void nullSubscriptionIsFree() {
            assertThat(service.isEntitled((Subscription) null)).isFalse();
        }
    }

    @Nested
    @DisplayName("entitledPlan / describe agree with isEntitled")
    class DerivedViews {

        // These three must never be able to disagree: one derivation, three readers. A past-due
        // household is the case that catches a `status == ACTIVE` shortcut in any of them.
        @Test
        void pastDueReadsAsPlusEverywhere() {
            Subscription subscription = subscription(SubscriptionStatus.PAST_DUE, BillingPlan.PLUS);
            when(repository.findByAccountId(7L)).thenReturn(Optional.of(subscription));

            assertThat(service.isEntitled(7L)).isTrue();
            assertThat(service.entitledPlan(7L)).isEqualTo(BillingPlan.PLUS);

            SubscriptionDto dto = service.describe(7L);
            assertThat(dto.plan()).isEqualTo(BillingPlan.PLUS);
            // The raw status still travels, because the screen needs it to explain WHY.
            assertThat(dto.status()).isEqualTo(SubscriptionStatus.PAST_DUE);
        }

        // ⚠️ The tier comes from the ROW, not from the fact that they are paying. With one paid
        // tier those are indistinguishable, so this is the assertion that stops a future second
        // paid tier from being silently flattened to PLUS by an `isEntitled ? PLUS : FREE`.
        @Test
        void theRecordedTierIsWhatEntitlementResolvesTo() {
            Subscription subscription = subscription(SubscriptionStatus.ACTIVE, BillingPlan.PLUS);
            when(repository.findByAccountId(7L)).thenReturn(Optional.of(subscription));

            assertThat(service.entitledPlan(7L)).isEqualTo(BillingPlan.PLUS);
            assertThat(service.entitledPlan(subscription)).isEqualTo(BillingPlan.PLUS);
        }

        // A lapse needs no write to take effect -- the same clock-driven property the CANCELED case
        // has always had. The row still SAYS Plus; entitlement says otherwise and wins.
        @Test
        void aLapsedSubscriptionReadsFreeEvenThoughTheRowStillRecordsPlus() {
            Subscription subscription = subscription(SubscriptionStatus.UNPAID, BillingPlan.PLUS);
            when(repository.findByAccountId(7L)).thenReturn(Optional.of(subscription));

            assertThat(service.entitledPlan(7L)).isEqualTo(BillingPlan.FREE);
            assertThat(service.has(7L, PlanFeature.FULL_HISTORY)).isFalse();
            assertThat(service.describe(7L).plan()).isEqualTo(BillingPlan.FREE);
        }

        // The contradiction branch: entitled, but the row records no tier. Only a hand-edited row
        // reaches this, and the safe answer is the lowest PAID tier -- never FREE, which would
        // clamp somebody who is demonstrably paying.
        @Test
        void anEntitledRowWithNoRecordedTierFallsBackToTheLowestPaidTier() {
            Subscription subscription = subscription(SubscriptionStatus.ACTIVE, BillingPlan.FREE);
            when(repository.findByAccountId(7L)).thenReturn(Optional.of(subscription));

            assertThat(service.entitledPlan(7L)).isEqualTo(BillingPlan.PLUS);
            assertThat(service.has(7L, PlanFeature.FULL_HISTORY)).isTrue();
        }

        // The gate every caller actually uses. Free holds no feature; Plus holds all three.
        @Test
        void hasAnswersFromTheFeatureMapRatherThanATierComparison() {
            when(repository.findByAccountId(1L))
                    .thenReturn(Optional.of(subscription(SubscriptionStatus.FREE, BillingPlan.FREE)));
            when(repository.findByAccountId(2L))
                    .thenReturn(Optional.of(subscription(SubscriptionStatus.ACTIVE, BillingPlan.PLUS)));

            for (PlanFeature feature : PlanFeature.values()) {
                assertThat(service.has(1L, feature)).as("FREE should not hold %s", feature).isFalse();
                assertThat(service.has(2L, feature)).as("PLUS should hold %s", feature).isTrue();
            }
        }
    }

    @Nested
    @DisplayName("applyStripeState: the welcome-to-Plus email fires at most once, ever")
    class PlusUpgradeEmail {

        private StripeSubscriptionState state(SubscriptionStatus status) {
            return new StripeSubscriptionState("cus_1", "sub_1", "price_1", status,
                    BillingInterval.MONTH, null, false);
        }

        // The one case this whole mechanism exists for: a household's first-ever transition into
        // Plus must tell somebody, exactly once.
        @Test
        void freeToActivePublishesTheUpgradeEventAndStampsTheColumn() {
            Subscription subscription = subscription(SubscriptionStatus.FREE);

            Subscription saved = service.applyStripeState(subscription, state(SubscriptionStatus.ACTIVE));

            verify(events).publishEvent(any(PlusUpgradedEvent.class));
            assertThat(saved.getPlusWelcomeSentAt()).isNotNull();
        }

        // A renewal, a card update, Portal-initiated changes -- applyStripeState runs on every one
        // of these for an already-Plus household. None of them may re-fire the welcome.
        @Test
        void activeToActiveDoesNotRepublish() {
            Subscription subscription = subscription(SubscriptionStatus.ACTIVE);
            subscription.setPlusWelcomeSentAt(clock.instant());

            service.applyStripeState(subscription, state(SubscriptionStatus.ACTIVE));

            verify(events, never()).publishEvent(any(PlusUpgradedEvent.class));
        }

        // The checkout-reconcile path (BillingController) and the webhook both call
        // applyStripeState for the same real-world upgrade -- a redelivered event or the browser
        // returning before the webhook lands. The column, not just the wasPlus/nowPlus comparison, is
        // what must stop the second one: this pins that the guard is `!wasPlus && nowPlus && column ==
        // null` and not merely `!wasPlus && nowPlus`, by forcing the column to already be set on an
        // otherwise-identical FREE -> ACTIVE transition.
        @Test
        void anAlreadyStampedRowNeverRepublishesEvenAcrossARealTransition() {
            Subscription subscription = subscription(SubscriptionStatus.FREE);
            subscription.setPlusWelcomeSentAt(clock.instant().minus(Duration.ofDays(1)));

            service.applyStripeState(subscription, state(SubscriptionStatus.ACTIVE));

            verify(events, never()).publishEvent(any(PlusUpgradedEvent.class));
        }

        // PAST_DUE is already Plus (isEntitled's own dunning-grace case) -- recovering FROM it back to
        // ACTIVE is not an upgrade and must not re-welcome someone whose card was simply retried.
        @Test
        void pastDueRecoveringToActiveDoesNotRepublish() {
            Subscription subscription = subscription(SubscriptionStatus.PAST_DUE);
            subscription.setPlusWelcomeSentAt(clock.instant());

            service.applyStripeState(subscription, state(SubscriptionStatus.ACTIVE));

            verify(events, never()).publishEvent(any(PlusUpgradedEvent.class));
        }

        // AccountPlanChangedEvent keeps firing unconditionally regardless -- this feature must not
        // have narrowed that one, which member-login pausing depends on.
        @Test
        void theUnconditionalPlanChangedEventStillFiresAlongsideIt() {
            Subscription subscription = subscription(SubscriptionStatus.FREE);

            service.applyStripeState(subscription, state(SubscriptionStatus.ACTIVE));

            verify(events).publishEvent(any(AccountPlanChangedEvent.class));
            verify(events).publishEvent(any(PlusUpgradedEvent.class));
        }

        // A downgrade (or anything that isn't a Free/lapsed -> Plus transition) must never stamp the
        // column -- doing so would silently disable a real future welcome for that household.
        @Test
        void aNonUpgradeLeavesTheColumnUntouched() {
            Subscription subscription = subscription(SubscriptionStatus.ACTIVE);

            Subscription saved = service.applyStripeState(subscription, state(SubscriptionStatus.CANCELED));

            assertThat(saved.getPlusWelcomeSentAt()).isNull();
            verify(events, never()).publishEvent(any(PlusUpgradedEvent.class));
        }
    }
}
