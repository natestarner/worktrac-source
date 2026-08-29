package com.worktrac.backend.billing;

// What a household is entitled to. Deliberately only two values: this is the DERIVED answer that
// SubscriptionService.isPro produces and AccountDto carries to the client, not a mirror of Stripe's
// subscription status (that is SubscriptionStatus). Keeping the two types separate is what stops
// the UI branching on Stripe vocabulary -- a screen should ask "is this household Pro", never
// "is this household past_due".
public enum BillingPlan {
    FREE,
    PRO
}
