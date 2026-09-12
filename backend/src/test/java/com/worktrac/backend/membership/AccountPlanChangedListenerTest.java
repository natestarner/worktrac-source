package com.worktrac.backend.membership;

import com.worktrac.backend.billing.AccountPlanChangedEvent;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * The listener that makes a plan change take effect on the next request rather than within the
 * cache TTL.
 *
 * <p>⚠️ <b>This exists because the wiring, not the logic, is what breaks.</b> The body is one
 * line and could hardly be wrong; what can be wrong — silently, with a 200 response and no log —
 * is an {@code @TransactionalEventListener(AFTER_COMMIT)} publishing from somewhere with no
 * transaction active, in which case Spring discards the event and nothing runs. That is exactly
 * how phase 7a's invitation email came to never send.
 *
 * <p>So the assertion worth making is not "the listener invalidates" (unit, below) but "the
 * publish actually reaches it". {@code MemberLoginPauseTest#resumingPlusUnpausesTheLoginImmediately}
 * is the end-to-end half of that, against a real household through the real HTTP stack.
 *
 * <p>{@code SubscriptionService.applyStripeState} — the single choke point all three production
 * plan-changing paths funnel through (the Stripe webhook, the billing controller's sync, and the
 * reconciliation watchdog) — is {@code @Transactional}, as are all three of its callers. That is
 * what makes AFTER_COMMIT safe there, and it is checked rather than assumed.
 */
class AccountPlanChangedListenerTest {

    @Test
    void dropsTheHouseholdsCachedAccessRows() {
        AccountAccessService accessService = mock(AccountAccessService.class);
        AccountPlanChangedListener listener = new AccountPlanChangedListener(accessService);

        listener.onPlanChanged(new AccountPlanChangedEvent(42L));

        // invalidateAccount, not invalidateUser: a plan belongs to the household, and every login
        // in it is affected. invalidateUser would clear the wrong axis -- one person across all
        // THEIR households, leaving the other members of this one still cached as Plus.
        verify(accessService).invalidateAccount(42L);
    }
}
