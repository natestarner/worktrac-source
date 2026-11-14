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

// Returns { url } for Stripe's hosted Customer Portal. `returnTo: 'app'` (the App Store app, which
// shows the portal in an in-app browser sheet) makes the portal's "Return to Huddle" land on
// /billing-done, a page that says to close the sheet, rather than on a signed-out web app inside it.
export function createPortalSession({ returnTo } = {}) {
  const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  return apiClient.post(`/api/billing/portal-session${query}`);
}

// (createCheckoutLink, the US link-out to Stripe's hosted page, is gone from this bundle: In-App
// Purchase replaced it. The backend keeps POST /api/billing/checkout-link for app builds 1.0-1.2,
// which still call it -- api-compatibility.md.)

// ---- In-App Purchase (lib/native/purchases.js; docs/in-app-purchase-plan.md) ----
// `store` is the backend's URL segment for the app's store ('app-store'; later 'google-play'),
// from purchases.storeSource(). Purchases are Tier-3 like checkout: online-only, never the outbox.

// [{ plan, band, interval, productId }] -- the store product ids this environment sells. The app
// asks the store for their prices; it never holds a product id or a price of its own.
export function getStoreProducts(store) {
  return apiClient.get(`/api/billing/store/${store}/products`);
}

// May this household buy, and with which household token? Answers { productId, accountToken }, or
// refuses (409) with a message saying where the plan is billed, or that another device is mid-purchase.
export function prepareStorePurchase(store, { plan, band = null, interval }) {
  return apiClient.post(`/api/billing/store/${store}/prepare`, { plan, band, interval });
}

// The purchase sheet closed without a purchase: let another device start one now.
export function releaseStorePurchase(store) {
  return apiClient.post(`/api/billing/store/${store}/release`);
}

// Sends the store's proofs ({ proof } each) for the backend to verify and apply. 2xx: every proof was
// handled and may be finished. Anything else: keep them unfinished; the store hands them back.
// Answers the household's SubscriptionDto.
export function syncStorePurchases(store, proofs) {
  return apiClient.post(`/api/billing/store/${store}/sync`, { proofs: proofs.map((p) => p.proof) });
}
