package com.worktrac.backend.billing;

// Which recurring price a household is on. The CLIENT sends one of these -- never a Stripe price
// id -- and the backend maps it to the configured price. That mapping direction is a security
// property, not a convenience: accepting a price id from the browser would let a caller check out
// against any price they cared to invent.
public enum BillingInterval {
    MONTH,
    YEAR
}
