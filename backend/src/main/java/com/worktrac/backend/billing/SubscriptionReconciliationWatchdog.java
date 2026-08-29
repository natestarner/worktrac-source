package com.worktrac.backend.billing;

import com.stripe.exception.StripeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

// The last-resort net for a webhook that never arrived, modelled on RegistrationDispatchWatchdog and
// existing for exactly the same reason: an async dispatch mechanism must never have a code path
// where "the event didn't arrive" and "it arrived and nothing went wrong" are indistinguishable
// from the outside (.claude/rules/registration-and-email.md).
//
// WHY THIS IS NEEDED AT ALL, given that entitlement expiry is clock-based:
//
//   The clock covers a CANCELED subscription -- once now passes current_period_end,
//   SubscriptionService.isPro stops returning true on its own, webhook or no webhook.
//
//   It does NOT cover an ACTIVE one. If customer.subscription.deleted is never received, `status`
//   stays ACTIVE forever and that household keeps Pro for free indefinitely, with nothing anywhere
//   to signal it. That failure is silent, unbounded, and costs money -- which is precisely the
//   shape a watchdog exists to catch.
//
// Deliberately conservative: it only looks at subscriptions whose paid period has already lapsed by
// a margin, and it never DECIDES anything itself. It asks Stripe and writes down the answer, so the
// authority stays in one place.
@Component
public class SubscriptionReconciliationWatchdog {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionReconciliationWatchdog.class);

    // Grace beyond current_period_end before a lapsed subscription is treated as suspicious.
    // Stripe renews at the boundary and the resulting webhook takes a moment; anything inside this
    // window is ordinary timing rather than drift. Generous on purpose -- a false alarm here writes
    // a misleading audit row, and the cost of waiting is only that a free ride lasts an hour longer.
    private static final Duration LAPSE_GRACE = Duration.ofHours(6);

    private final SubscriptionService subscriptionService;
    private final StripeService stripeService;
    private final BillingAuditService auditService;
    private final Clock clock;

    public SubscriptionReconciliationWatchdog(SubscriptionService subscriptionService,
                                               StripeService stripeService,
                                               BillingAuditService auditService, Clock clock) {
        this.subscriptionService = subscriptionService;
        this.stripeService = stripeService;
        this.auditService = auditService;
        this.clock = clock;
    }

    // Hourly. Far less frequent than the email watchdog's 5 minutes, because the failure it catches
    // costs money slowly rather than losing a person's registration.
    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT5M")
    public void reconcileLapsedSubscriptions() {
        if (!stripeService.isConfigured()) {
            return;
        }
        Instant cutoff = clock.instant().minus(LAPSE_GRACE);
        List<Subscription> lapsed = subscriptionService.findLapsedButStillEntitled(cutoff);
        for (Subscription subscription : lapsed) {
            reconcileOne(subscription);
        }
    }

    // Each subscription in its own transaction: one household whose Stripe read fails must not
    // abort the sweep for every household after it.
    @Transactional
    public void reconcileOne(Subscription subscription) {
        Long accountId = subscription.getAccount().getId();
        String stripeSubscriptionId = subscription.getStripeSubscriptionId();
        if (stripeSubscriptionId == null) {
            // Entitled, past its period end, and no Stripe subscription to ask about. Only reachable
            // for a hand-edited row, but recording it is the whole point of a watchdog.
            auditService.record(accountId, BillingEventType.RECONCILE_DRIFT_CORRECTED,
                    "Lapsed subscription has no Stripe id to verify against");
            return;
        }

        SubscriptionStatus before = subscription.getStatus();
        try {
            StripeSubscriptionState state = stripeService.fetchSubscriptionState(stripeSubscriptionId);
            subscriptionService.applyStripeState(subscription, state);

            if (state.status() != before) {
                // The whole reason this class exists: Stripe and this database disagreed, which
                // means a webhook was missed. Recorded so it is visible rather than silently fixed.
                auditService.record(accountId, BillingEventType.RECONCILE_DRIFT_CORRECTED,
                        "Local status was " + before + ", Stripe says " + state.status()
                                + " -- a webhook was missed");
                log.warn("Corrected billing drift for account {}: {} -> {}", accountId, before, state.status());
            }
        } catch (StripeException e) {
            // Transient: try again on the next sweep. Recorded so a persistently unreachable
            // subscription is visible rather than quietly retried forever.
            auditService.record(accountId, BillingEventType.RECONCILE_DRIFT_CORRECTED,
                    "FAILED to verify against Stripe: " + e.getMessage());
            log.error("Could not reconcile subscription for account {}", accountId, e);
        }
    }
}
