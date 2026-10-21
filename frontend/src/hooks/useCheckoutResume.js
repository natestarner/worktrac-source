import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { reconcileCheckout } from '../api/billing';
import { clearPendingCheckout, readPendingCheckout } from '../lib/pendingCheckout';
import { isPaidPlan } from '../utils/planFeatures';

// Finishes an App Store checkout when the person comes back to the app (mounted in AppShell).
//
// The app sent them to Stripe's hosted page with a session id it kept (lib/pendingCheckout.js). On
// every return to the foreground it asks the server to reconcile that session -- the same
// idempotent call BillingTab makes on the web's ?checkout= return -- and:
//   - paid  -> clears the marker and opens /app/billing?checkout=<id>, so BillingTab's existing
//              reconcile + PlusCelebration run exactly as they do after a web checkout. One finish
//              path, not two. (BillingTab's own reconcile repeats the call; it is idempotent.)
//   - not paid yet -> keeps the marker. They may have only switched apps mid-checkout and will pay
//              next; an abandoned one expires after a day. Never a celebration for an unpaid plan.
//   - a 4xx -> the session isn't this household's or isn't valid: clears it. A network error or 5xx
//              keeps it for the next return.
// The webhook and the reconciliation watchdog apply the purchase regardless of any of this, so a
// missed return delays the celebration; it never loses the payment.
//
// Only the App Store app ever writes the marker, so on the web this reads null and does nothing.
// Calls reconcileCheckout directly, as BillingTab does: it is an idempotent confirmation, not a
// purchase, so it has no gate to pass and nothing to queue.
export function useCheckoutResume() {
  const navigate = useNavigate();
  useEffect(() => {
    let running = false;
    async function check() {
      if (running || document.visibilityState !== 'visible') return;
      const sessionId = readPendingCheckout();
      if (!sessionId) return;
      running = true;
      try {
        const result = await reconcileCheckout(sessionId);
        if (isPaidPlan(result?.plan)) {
          clearPendingCheckout();
          navigate(`/app/billing?checkout=${encodeURIComponent(sessionId)}`);
        }
      } catch (error) {
        const status = error?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) clearPendingCheckout();
      } finally {
        running = false;
      }
    }
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [navigate]);
}
