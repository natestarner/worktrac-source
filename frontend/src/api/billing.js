import { apiClient } from './client';

// Billing reads and writes. The three writes below are all Tier-3 (online-only): they are not
// idempotent, so they must never enter the durable outbox, and every call site goes through
// useGatedMutation. See .claude/rules/resilience.md's mechanism table.

export function getSubscription() {
  return apiClient.get('/api/billing/subscription');
}

// Returns { clientSecret, publishableKey }. Sends MONTH or YEAR -- never a Stripe price id; the
// backend owns that mapping, and accepting one from here would let a caller check out against any
// price they cared to invent.
// Sends SYMBOLS the server maps to a Stripe price -- never a price id, which would let a caller
// check out against a price they invented. `plan` and `band` are optional: a body carrying only an
// interval still means Plus, which is the shape this endpoint had when Plus was the only thing for
// sale and is what keeps the Plus upgrade path a one-argument call.
export function createCheckoutSession(interval, { plan, band } = {}) {
  return apiClient.post('/api/billing/checkout-session', { interval, plan, band });
}

// Reads a completed checkout back through the backend, which verifies the session belongs to this
// household before applying it. This is what makes the upgrade visible the moment Stripe returns
// the browser, rather than waiting on a webhook.
export function reconcileCheckout(sessionId) {
  return apiClient.post(`/api/billing/checkout-session/${encodeURIComponent(sessionId)}/reconcile`);
}

// Returns { url } for Stripe's hosted Customer Portal.
export function createPortalSession() {
  return apiClient.post('/api/billing/portal-session');
}
