package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;

// The one place "is this household Pro?" is answered, for the whole application.
//
// ENTITLEMENT IS DERIVED, NEVER STORED. There is deliberately no is_pro column to read. One
// expression gets four otherwise-separate cases right, and splitting it into a stored flag would
// turn each of them into something to keep in sync:
//
//   1. PAST_DUE still counts as Pro. Stripe is retrying the card (Smart Retries); cutting access
//      mid-dunning is how a recoverable payment failure becomes a cancellation. The person keeps
//      what they are paying for while Stripe sorts the card out.
//   2. CANCELED counts as Pro until currentPeriodEnd. They bought that period.
//   3. Expiry happens BY THE CLOCK. A cancelled subscription stops being Pro when the period ends,
//      whether or not Stripe's subscription.deleted webhook ever arrives. (The ACTIVE case is the
//      one the clock cannot save -- that is what SubscriptionReconciliationWatchdog is for.)
//   4. comped grants Pro with no Stripe object at all, so founding households need no second code
//      path anywhere downstream.
//
// A MISSING ROW MEANS FREE, never an error. Every account gets a row at registration and V56
// backfilled the rest, so a missing row should be impossible -- but a read of workout history must
// not fail because billing has no opinion about that household yet.
@Service
public class SubscriptionService {

    // Statuses Stripe considers "in good standing", i.e. entitled outright.
    private static final Set<SubscriptionStatus> ENTITLED_OUTRIGHT =
            EnumSet.of(SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE);

    private final SubscriptionRepository subscriptionRepository;
    private final Clock clock;

    public SubscriptionService(SubscriptionRepository subscriptionRepository, Clock clock) {
        this.subscriptionRepository = subscriptionRepository;
        this.clock = clock;
    }

    // THE derivation. Everything that gates on Pro calls this -- never a status comparison of its
    // own, and never a stored flag.
    public boolean isPro(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId)
                .map(this::isPro)
                .orElse(false);
    }

    public boolean isPro(Subscription subscription) {
        if (subscription == null) {
            return false;
        }
        if (subscription.isComped()) {
            return true;
        }
        if (ENTITLED_OUTRIGHT.contains(subscription.getStatus())) {
            return true;
        }
        // Cancelled, but paid through the end of the period they bought. This is also what makes
        // expiry work with no webhook: once now passes currentPeriodEnd, this stops being true on
        // its own.
        return subscription.getStatus() == SubscriptionStatus.CANCELED
                && subscription.getCurrentPeriodEnd() != null
                && subscription.getCurrentPeriodEnd().isAfter(clock.instant());
    }

    // How far back a household may SEE. Pro sees everything (null floor); Free sees the trailing
    // window. THE ROWS ARE NEVER TOUCHED -- this is a read filter and nothing else, which is what
    // makes the marketing promise ("Your workouts are never deleted on Free") literally true and
    // what makes re-subscribing restore everything instantly. See .claude/rules/billing.md.
    //
    // Server-side on purpose. The client's copy of the plan drives chrome only, so an unreachable
    // server can never clamp anyone -- and offlineCacheWarm caches whatever the server already
    // filtered, which makes a Free household's history look identical online and off with no
    // second code path.
    public static final Duration FREE_HISTORY_WINDOW = Duration.ofDays(90);

    public Instant historyFloor(Long accountId) {
        return isPro(accountId) ? null : clock.instant().minus(FREE_HISTORY_WINDOW);
    }

    // True when `moment` is visible to this household. Null floor (Pro) admits everything, and a
    // null moment is admitted too -- a row with no timestamp is a data problem, not something to
    // silently hide behind a paywall.
    public static boolean isVisible(Instant floor, Instant moment) {
        return floor == null || moment == null || !moment.isBefore(floor);
    }

    public BillingPlan planFor(Long accountId) {
        return isPro(accountId) ? BillingPlan.PRO : BillingPlan.FREE;
    }

    public Optional<Subscription> findByAccountId(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId);
    }

    // What the billing screen reads. A household with no row renders as Free rather than erroring,
    // for the same reason isPro does.
    public SubscriptionDto describe(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId)
                .map(subscription -> SubscriptionDto.from(subscription, isPro(subscription)))
                .orElseGet(SubscriptionDto::free);
    }

    // Called from RegistrationService the moment an account exists, so "one row per account" is
    // true from the start rather than only for accounts that reach billing.
    @Transactional
    public Subscription createFreeSubscription(Account account) {
        return subscriptionRepository.save(new Subscription(account, clock.instant()));
    }

    // Idempotent get-or-create, for the paths that must not assume registration got there first
    // (a checkout started by an account created before V56 ran, or by a test fixture).
    @Transactional
    public Subscription getOrCreate(Account account) {
        return subscriptionRepository.findByAccountId(account.getId())
                .orElseGet(() -> subscriptionRepository.save(new Subscription(account, clock.instant())));
    }

    // The single writer of plan/status, called by BOTH the checkout-session reconcile and the
    // webhook. Two callers, one writer -- so the immediate success path and the asynchronous one
    // can never disagree about what a given Stripe state means.
    //
    // Callers pass state they read from Stripe just now, NOT a webhook payload they were handed:
    // Stripe does not guarantee event ordering, so applying payloads blindly lets a stale
    // subscription.updated overwrite a newer subscription.created. Re-fetching makes ordering
    // irrelevant and lets a missed event self-heal on the next one.
    @Transactional
    public Subscription applyStripeState(Subscription subscription, StripeSubscriptionState state) {
        subscription.setStripeSubscriptionId(state.stripeSubscriptionId());
        subscription.setStripePriceId(state.stripePriceId());
        subscription.setStatus(state.status());
        subscription.setBillingInterval(state.billingInterval());
        subscription.setCurrentPeriodEnd(state.currentPeriodEnd());
        subscription.setCancelAtPeriodEnd(state.cancelAtPeriodEnd());
        if (state.stripeCustomerId() != null) {
            subscription.setStripeCustomerId(state.stripeCustomerId());
        }
        // plan is the derived answer materialized for cheap reads (the admin list, AccountDto).
        // isPro stays the authority -- this is a cache of it, computed here so the two cannot be
        // set independently.
        subscription.setPlan(isPro(subscription) ? BillingPlan.PRO : BillingPlan.FREE);
        subscription.setUpdatedAt(clock.instant());
        return subscriptionRepository.save(subscription);
    }

    // Used by the reconciliation watchdog to find subscriptions whose paid period has lapsed while
    // their status still claims good standing -- the shape a missed subscription.deleted leaves.
    public java.util.List<Subscription> findLapsedButStillEntitled(Instant cutoff) {
        return subscriptionRepository.findByStatusInAndCurrentPeriodEndLessThan(
                java.util.List.copyOf(ENTITLED_OUTRIGHT), cutoff);
    }
}
