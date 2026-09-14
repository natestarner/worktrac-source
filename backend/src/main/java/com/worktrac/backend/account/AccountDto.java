package com.worktrac.backend.account;

import com.worktrac.backend.billing.BillingPlan;

// `plan` is the DERIVED entitlement (SubscriptionService.isPlus), not raw Stripe status -- the app
// shell should ask "is this household Plus", never "is this household past_due". It reaches the
// client through MeResponse/AuthResponse and is persisted in the frontend's auth snapshot, which is
// what lets the header render the right control while offline.
//
// It drives CHROME ONLY. The server never trusts a plan the client sends back, and never needs to:
// every gate reads the subscription row directly. That separation is what stops an unreachable
// server from downgrading anyone -- see .claude/rules/billing.md.
// `vocab` rides along for the same reason `plan` does -- it is chrome, it must survive a cold
// offline boot, and it is derived from the plan rather than stored. Deriving it INSIDE `from` (the
// only way this record is built) is what stops a call site producing a DTO whose nouns disagree
// with its tier.
// `membersSeeEveryone` is here so the owner's settings toggle can render its CURRENT state without
// a second request, and render it correctly on a cold offline boot. It is chrome like the rest of
// this record: AccountAccess carries the copy that actually filters reads, resolved per request
// from the row rather than from anything the client holds.
public record AccountDto(Long id, String name, String defaultUnit, BillingPlan plan, AccountVocab vocab,
                         boolean membersSeeEveryone) {

    public static AccountDto from(Account account, BillingPlan plan) {
        return new AccountDto(account.getId(), account.getName(), account.getDefaultUnit(), plan,
                AccountVocab.forPlan(plan), account.isMembersSeeEveryone());
    }
}
