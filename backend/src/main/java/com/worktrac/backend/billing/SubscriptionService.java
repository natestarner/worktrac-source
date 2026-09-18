package com.worktrac.backend.billing;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.config.StripeProperties;
import com.worktrac.backend.membership.AccountMembershipRepository;
import com.worktrac.backend.membership.AccountRole;
import com.worktrac.backend.person.PersonRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;

// The one place "what is this household entitled to?" is answered, for the whole application.
//
// TWO QUESTIONS, ONE AUTHORITY. `isEntitled` answers "is this subscription currently paying?" --
// the four-case derivation below, unchanged since it shipped. `entitledPlan` combines that with the
// tier the row records, and every gate reads it through `has(accountId, PlanFeature)`. Callers ask
// for a FEATURE, never for a tier: BillingPlan.features() is the only place a tier becomes
// capability, exactly as AccountRole.permissions() is the only place a role becomes authority.
//
// ENTITLEMENT IS DERIVED, NEVER STORED. There is deliberately no is_plus column to read. One
// expression gets four otherwise-separate cases right, and splitting it into a stored flag would
// turn each of them into something to keep in sync:
//
//   1. PAST_DUE still counts as Plus. Stripe is retrying the card (Smart Retries); cutting access
//      mid-dunning is how a recoverable payment failure becomes a cancellation. The person keeps
//      what they are paying for while Stripe sorts the card out.
//   2. CANCELED counts as Plus until currentPeriodEnd. They bought that period.
//   3. Expiry happens BY THE CLOCK. A cancelled subscription stops being Plus when the period ends,
//      whether or not Stripe's subscription.deleted webhook ever arrives. (The ACTIVE case is the
//      one the clock cannot save -- that is what SubscriptionReconciliationWatchdog is for.)
//   4. comped grants Plus with no Stripe object at all, so founding households need no second code
//      path anywhere downstream.
//
// A MISSING ROW MEANS FREE, never an error. Every account gets a row at registration and V56
// backfilled the rest, so a missing row should be impossible -- but a read of workout history must
// not fail because billing has no opinion about that household yet.
@Service
public class SubscriptionService {

    // The lowest tier that is paid for. Only reachable from entitledPlan's contradiction branch.
    private static final BillingPlan LOWEST_PAID_PLAN = BillingPlan.PLUS;

    // Statuses Stripe considers "in good standing", i.e. entitled outright.
    private static final Set<SubscriptionStatus> ENTITLED_OUTRIGHT =
            EnumSet.of(SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE);

    private final SubscriptionRepository subscriptionRepository;
    private final ApplicationEventPublisher events;
    private final StripeProperties stripeProperties;
    private final PersonRepository personRepository;
    private final AccountMembershipRepository membershipRepository;
    private final Clock clock;

    // ⚠️ Takes StripeProperties for the price->tier map ONLY, never to talk to Stripe. StripeService
    // is still the only class that imports com.stripe.* (billing.md), and this depends on the
    // configuration rather than on the SDK -- which is what keeps applyStripeState unit-testable
    // with a plain properties object and no HTTP stub.
    //
    // Takes PersonRepository and AccountMembershipRepository for `describe`'s "12 of 15 clients"
    // count only -- the same reads QuotaService.requirePersonCapacity already does before adding a
    // person, just for display rather than for a gate.
    public SubscriptionService(SubscriptionRepository subscriptionRepository,
                                ApplicationEventPublisher events, StripeProperties stripeProperties,
                                PersonRepository personRepository,
                                AccountMembershipRepository membershipRepository, Clock clock) {
        this.subscriptionRepository = subscriptionRepository;
        this.events = events;
        this.stripeProperties = stripeProperties;
        this.personRepository = personRepository;
        this.membershipRepository = membershipRepository;
        this.clock = clock;
    }

    // THE derivation: is this subscription currently paying? Never a status comparison of its own
    // at a call site, and never a stored flag.
    //
    // This deliberately says nothing about WHICH tier -- that is entitledPlan's job. Splitting the
    // two is what lets a third tier be added without touching any of the four cases below, each of
    // which was expensive to get right.
    public boolean isEntitled(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId)
                .map(this::isEntitled)
                .orElse(false);
    }

    public boolean isEntitled(Subscription subscription) {
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

    // How far back a household may SEE. Plus sees everything (null floor); Free sees the trailing
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
        return has(accountId, PlanFeature.FULL_HISTORY) ? null : clock.instant().minus(FREE_HISTORY_WINDOW);
    }

    // True when `moment` is visible to this household. Null floor (Plus) admits everything, and a
    // null moment is admitted too -- a row with no timestamp is a data problem, not something to
    // silently hide behind a paywall.
    public static boolean isVisible(Instant floor, Instant moment) {
        return floor == null || moment == null || !moment.isBefore(floor);
    }

    /**
     * The tier this household is entitled to RIGHT NOW -- the one authority on that question.
     *
     * <p>Two inputs: whether the subscription is paying at all (isEntitled, above) and which tier
     * the row records. A lapsed subscription reads FREE regardless of the tier it used to hold, so
     * a downgrade needs no write to take effect -- the same clock-driven property the CANCELED case
     * has always had.
     *
     * <p>{@code subscriptions.billing_plan} is a cache of this, written only by applyStripeState so
     * the two cannot be set independently. This method stays the authority.
     */
    public BillingPlan entitledPlan(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId)
                .map(this::entitledPlan)
                .orElse(BillingPlan.FREE);
    }

    public BillingPlan entitledPlan(Subscription subscription) {
        if (!isEntitled(subscription)) {
            return BillingPlan.FREE;
        }
        // A comp's tier comes from the comp, not from billing_plan. The two are separate columns
        // because billing_plan is a cache of present entitlement that applyStripeState rewrites on
        // every Stripe event, while a comp is a standing grant meant to outlive exactly that. Null
        // comped_plan means PLUS -- what every comp granted before Pro existed.
        if (subscription.isComped()) {
            BillingPlan granted = subscription.getCompedPlan();
            return granted == null ? LOWEST_PAID_PLAN : granted;
        }
        BillingPlan recorded = subscription.getPlan();
        // An entitled row recording no tier is a contradiction applyStripeState cannot produce --
        // it writes both together. Reachable only by a hand-edited row, and the safe answer is the
        // LOWEST paid tier: somebody demonstrably paying must not be treated as Free, and guessing
        // upward would hand out a tier nobody bought. That rule keeps working as tiers are added,
        // which a literal `return PLUS` would not.
        return recorded == null || recorded == BillingPlan.FREE ? LOWEST_PAID_PLAN : recorded;
    }

    /**
     * Writes the tier and seat count the Stripe price says was bought.
     *
     * <p>⚠️ AN UNRECOGNISED PRICE KEEPS THE TIER THE ROW ALREADY HAD, rather than falling back to
     * the lowest paid one. A price id we cannot map is a CONFIG gap on our side — an env var not
     * carried to this environment, or a Price created in the Dashboard and never wired up — and
     * it is not evidence about what the household bought. Downgrading a paying Pro trainer to Plus
     * because somebody forgot an env var would be the worst possible reading of it, and it would
     * self-inflict on every webhook until the config was fixed. Keeping the tier degrades to "stale
     * but right"; the reconciliation watchdog re-applies once the mapping exists.
     *
     * <p>Seats travel with the tier for the same reason: a band change IS a price change, so the
     * two cannot be written independently without drifting.
     */
    private void applyPurchasedTier(Subscription subscription, boolean entitled) {
        if (!entitled) {
            subscription.setPlan(BillingPlan.FREE);
            subscription.setClientSeats(null);
            return;
        }
        Optional<PlanSku> sku = stripeProperties.skuForPriceId(subscription.getStripePriceId());
        if (sku.isEmpty()) {
            return;
        }
        subscription.setPlan(sku.get().plan());
        subscription.setClientSeats(sku.get().band() == null ? null : sku.get().band().clientLimit());
    }

    /**
     * A household's tier and its seat allowance, from ONE read.
     *
     * <p>Exists because {@code AccountAccessService} caches both and would otherwise hit the
     * subscriptions table twice per cache miss to learn two facts that come off the same row --
     * on the app's hottest path, resolved for every request that misses.
     */
    public record Entitlement(BillingPlan plan, Integer clientSeats) {

        static final Entitlement FREE = new Entitlement(BillingPlan.FREE, null);
    }

    public Entitlement entitlementOf(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId)
                .map(subscription -> {
                    BillingPlan plan = entitledPlan(subscription);
                    // Seats only mean anything while the tier that has them is actually in force.
                    // A lapsed Pro subscription still RECORDS the band it bought; reporting those
                    // seats would hand a Free account a roster allowance it is not paying for.
                    return plan == BillingPlan.FREE
                            ? Entitlement.FREE
                            : new Entitlement(plan, subscription.getClientSeats());
                })
                .orElse(Entitlement.FREE);
    }

    /**
     * Whether this household's plan includes the given feature. THE gate every caller uses.
     *
     * <p>⚠️ Ask for a feature, never for a tier. An {@code entitledPlan(id) == BillingPlan.PLUS} at
     * a call site is the bug -- it is exactly the comparison this method exists to keep in one
     * place, the same way AccountAccess.has keeps role comparisons in one place.
     */
    public boolean has(Long accountId, PlanFeature feature) {
        return entitledPlan(accountId).has(feature);
    }

    public Optional<Subscription> findByAccountId(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId);
    }

    // What the billing screen reads. A household with no row renders as Free rather than erroring,
    // for the same reason entitledPlan does.
    public SubscriptionDto describe(Long accountId) {
        return subscriptionRepository.findByAccountId(accountId)
                .map(subscription -> {
                    BillingPlan plan = entitledPlan(subscription);
                    // Only meaningful on PRO, which is the only tier with seats to count usage
                    // against -- SubscriptionDto.from clamps this to null on every other tier anyway,
                    // but skipping both queries for the common (non-Pro) case keeps them off this
                    // endpoint's cost.
                    Integer clientCount = plan == BillingPlan.PRO ? currentClientCount(accountId) : null;
                    return SubscriptionDto.from(subscription, plan, clientCount);
                })
                .orElseGet(SubscriptionDto::free);
    }

    // Everyone on the account minus the two kinds of person who are not a CLIENT: the trainer's own
    // training profile, and an assistant's (MANAGER's) own -- the same "clientSeats + 1" people
    // ceiling QuotaService.requirePersonCapacity enforces for the trainer, extended to managers for
    // the same reason. Neither spends a client seat, so neither should count as one here.
    private int currentClientCount(Long accountId) {
        long people = personRepository.countByAccount_Id(accountId);
        long managersWithAPerson = membershipRepository
                .countByAccount_IdAndAccountRoleAndPersonIsNotNull(accountId, AccountRole.MANAGER);
        return (int) Math.max(0, people - 1 - managersWithAPerson);
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
        // Captured before anything below mutates the row -- the whole basis for firstUpgrade further
        // down. AccountPlanChangedEvent (below) deliberately skips this comparison because getting
        // it wrong fails silently; this one is worth it anyway because a welcome email's failure
        // mode (missed or duplicated) is worse than a cache staying stale an extra minute, and
        // PlusWelcomeSentAt is what keeps a wrong comparison here from ever double-sending.
        boolean wasEntitled = isEntitled(subscription);

        subscription.setStripeSubscriptionId(state.stripeSubscriptionId());
        subscription.setStripePriceId(state.stripePriceId());
        subscription.setStatus(state.status());
        subscription.setBillingInterval(state.billingInterval());
        subscription.setCurrentPeriodEnd(state.currentPeriodEnd());
        subscription.setCancelAtPeriodEnd(state.cancelAtPeriodEnd());
        if (state.stripeCustomerId() != null) {
            subscription.setStripeCustomerId(state.stripeCustomerId());
        }
        // plan and client_seats are the derived answers materialized for cheap reads (the admin
        // list, AccountDto, the quota check). entitledPlan stays the authority -- these are a cache
        // of it, computed here so the two cannot be set independently.
        //
        // ⚠️ THE TIER COMES FROM THE PRICE, not from the fact that they are paying. The price id is
        // the only thing in a Stripe payload that says WHICH tier was bought, so with two paid
        // tiers an `isEntitled ? PLUS : FREE` here would silently write PLUS over a Pro
        // subscription on the very next webhook.
        boolean nowEntitled = isEntitled(subscription);
        applyPurchasedTier(subscription, nowEntitled);
        subscription.setUpdatedAt(clock.instant());

        // The welcome email fires at most once per account, ever -- the null check is what makes
        // that exact rather than best-effort even if a future edit gets wasEntitled/nowEntitled subtly wrong,
        // and it is why a renewal (Plus -> Plus) or a PAST_DUE recovery (both already Plus) never
        // re-triggers it.
        boolean firstUpgrade = !wasEntitled && nowEntitled && subscription.getPlusWelcomeSentAt() == null;
        if (firstUpgrade) {
            subscription.setPlusWelcomeSentAt(clock.instant());
        }

        Subscription saved = subscriptionRepository.save(subscription);

        // Member logins are gated on this household being Plus, and that answer is cached per login
        // for a minute (AccountAccessService). Without this, a re-upgrade leaves somebody who has
        // just paid looking at a "your login is paused" screen for up to another minute -- which is
        // precisely when they conclude it did not work. Published from HERE because this method is
        // the single choke point all three plan-changing paths already funnel through: the Stripe
        // webhook, the billing controller's sync, and the reconciliation watchdog.
        events.publishEvent(new AccountPlanChangedEvent(saved.getAccount().getId()));

        if (firstUpgrade) {
            events.publishEvent(new PlusUpgradedEvent(saved.getAccount().getId(), saved.getPlan()));
        }

        return saved;
    }

    // Used by the reconciliation watchdog to find subscriptions whose paid period has lapsed while
    // their status still claims good standing -- the shape a missed subscription.deleted leaves.
    public java.util.List<Subscription> findLapsedButStillEntitled(Instant cutoff) {
        return subscriptionRepository.findByStatusInAndCurrentPeriodEndLessThan(
                java.util.List.copyOf(ENTITLED_OUTRIGHT), cutoff);
    }
}
