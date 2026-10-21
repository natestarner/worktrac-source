// The Stripe checkout the App Store app has just sent someone to, remembered so the app can confirm
// it when they come back (hooks/useCheckoutResume.js).
//
// localStorage, written synchronously BEFORE the browser opens: iOS may kill a backgrounded app,
// and a marker written asynchronously could be lost with it -- leaving a payment the app never
// reconciles (the webhook would still apply it, but the person would see no celebration and stay on
// Free until the next /me). Same reasoning as frontend-core.md's "written SYNCHRONOUSLY" rule.
//
// Expires after a day, the life of a Stripe Checkout Session: after that there is nothing left to
// confirm, and an abandoned checkout should stop costing a request on every return to the app.
const KEY = 'worktrac-pending-checkout';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function rememberPendingCheckout(sessionId, now = Date.now()) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ sessionId, at: now }));
  } catch {
    // Storage unavailable: the webhook still applies the purchase; only the instant on-return
    // confirmation is lost, never the payment.
  }
}

export function readPendingCheckout(now = Date.now()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!parsed?.sessionId) return null;
    if (now - (parsed.at ?? 0) > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed.sessionId;
  } catch {
    // Unreadable marker: behave as if there were none. The webhook remains the backstop.
    return null;
  }
}

export function clearPendingCheckout() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // A marker that can't be removed expires on its own after a day.
  }
}
