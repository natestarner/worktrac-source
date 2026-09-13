package com.worktrac.backend.membership;

import com.worktrac.backend.billing.AccountPlanChangedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Drops a household's cached access rows when its plan changes, so a member's pause takes effect
 * on the next request instead of within the cache TTL.
 *
 * <p><b>The re-upgrade direction is the one that matters most.</b> A downgrade being a minute late
 * is nearly harmless — the member keeps working slightly longer than they strictly should. A
 * RE-UPGRADE being a minute late means somebody who has just paid stares at a "your login is
 * paused" screen with no way to tell whether the payment worked, which is exactly when they
 * contact support.
 *
 * <p>⚠️ <b>{@code AFTER_COMMIT}, and it is safe here — checked, not assumed.</b> An
 * {@code @TransactionalEventListener} with the default {@code fallbackExecution = false} silently
 * discards anything published with no transaction active, which is how the phase 7a invite email
 * came to never send. This event is published from inside
 * {@code SubscriptionService.applyStripeState}, which is {@code @Transactional}, as are all three
 * of its callers (the Stripe webhook, the billing controller's sync, and the reconciliation
 * watchdog).
 *
 * <p>⚠️ <b>{@code PlanChangeInvalidatesAccessTest} is the ONLY thing covering that delivery, and
 * it was written after checking rather than assuming.</b> Commenting out the {@code @Component}
 * below leaves every one of {@code MemberLoginPauseTest}'s nine assertions green — because that
 * class drives the plan through {@code /api/auth/test/billing-plan}, which invalidates directly
 * rather than through this event. {@code AccountPlanChangedListenerTest} calls the method by hand
 * and proves nothing about delivery either. Two mechanisms can satisfy the same assertion, and
 * only one of them is the one under test.
 *
 * <p>AFTER_COMMIT is also the correct phase rather than merely an available one: invalidating
 * before the commit leaves a window in which a concurrent request reloads the cache from the
 * pre-commit state and pins the stale answer for another full TTL.
 *
 * <p>Deliberately NOT {@code @Async}. This is an in-memory map removal — handing it to a thread
 * pool would add a scheduling delay to the one thing whose entire purpose is being immediate.
 */
@Component
public class AccountPlanChangedListener {

    private static final Logger log = LoggerFactory.getLogger(AccountPlanChangedListener.class);

    private final AccountAccessService accountAccessService;

    public AccountPlanChangedListener(AccountAccessService accountAccessService) {
        this.accountAccessService = accountAccessService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPlanChanged(AccountPlanChangedEvent event) {
        accountAccessService.invalidateAccount(event.accountId());
        log.debug("Access cache invalidated for account {} after a plan change", event.accountId());
    }
}
