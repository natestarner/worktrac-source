package com.worktrac.backend.account;

import com.worktrac.backend.billing.BillingPlan;

// `plan` is the DERIVED entitlement (SubscriptionService.isPro), not raw Stripe status -- the app
// shell should ask "is this household Pro", never "is this household past_due". It reaches the
// client through MeResponse/AuthResponse and is persisted in the frontend's auth snapshot, which is
// what lets the header render the right control while offline.
//
// It drives CHROME ONLY. The server never trusts a plan the client sends back, and never needs to:
// every gate reads the subscription row directly. That separation is what stops an unreachable
// server from downgrading anyone -- see .claude/rules/billing.md.
public record AccountDto(Long id, String name, String defaultUnit, BillingPlan plan) {

    public static AccountDto from(Account account, BillingPlan plan) {
        return new AccountDto(account.getId(), account.getName(), account.getDefaultUnit(), plan);
    }
}
