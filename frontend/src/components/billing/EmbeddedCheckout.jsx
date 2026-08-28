import { useEffect, useRef, useState } from 'react';
import Spinner from '../shared/Spinner';

// Mounts Stripe's embedded Checkout into the billing screen.
//
// EMBEDDED rather than a redirect to checkout.stripe.com, and the reason is specific to this app:
// Huddle runs as an installed PWA on iPhone and iPad, where a cross-origin navigation out of a
// standalone app can hand the person to Safari and not reliably hand them back -- stranding
// someone mid-upgrade outside the app they just paid for. Both options are Stripe-hosted and both
// keep this codebase in PCI SAQ-A; no card data touches our code either way.
//
// loadStripe() is called HERE, inside a component that only mounts once someone has actually
// started a checkout -- never at module scope. That is what keeps js.stripe.com off the app's boot
// path entirely: an offline household never requests it, and the app has no third-party runtime
// dependency until the moment it genuinely needs one.
export default function EmbeddedCheckout({ clientSecret, publishableKey, onComplete, onError }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  // Read fresh inside the effect without listing as dependencies -- the effect must run exactly
  // once per clientSecret, and a caller passing inline arrow functions would otherwise tear down
  // and remount Stripe's iframe on every render of the parent.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!clientSecret || !publishableKey) return undefined;

    let checkout;
    let cancelled = false;

    async function mount() {
      try {
        // Dynamic import, not a static one: this keeps the Stripe wrapper out of the main bundle
        // as well as off the boot path. The same shape ImportDataModal uses for its xlsx converter
        // -- and, like that one, it is a branch on WHAT IS BEING DONE, never on connectivity.
        const { loadStripe } = await import('@stripe/stripe-js');
        const stripe = await loadStripe(publishableKey);
        if (cancelled) return;
        if (!stripe) {
          // loadStripe resolves to null when the script could not be fetched at all -- an ad
          // blocker, a captive portal, a network that died between the gate and here. It must
          // surface, not spin: a spinner over a request that will never succeed is the one outcome
          // the degraded-conditions contract forbids outright.
          onErrorRef.current?.();
          return;
        }

        checkout = await stripe.initEmbeddedCheckout({
          clientSecret,
          onComplete: () => onCompleteRef.current?.(),
        });
        if (cancelled) {
          checkout.destroy();
          return;
        }
        checkout.mount(containerRef.current);
        setLoading(false);
      } catch (error) {
        console.error('Could not mount Stripe checkout', error);
        if (!cancelled) onErrorRef.current?.();
      }
    }

    mount();

    return () => {
      cancelled = true;
      // Stripe's iframe outlives React's own teardown unless it is destroyed explicitly, and a
      // stale one left behind would keep a live payment form mounted over whatever renders next.
      if (checkout) checkout.destroy();
    };
  }, [clientSecret, publishableKey]);

  return (
    <div>
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-6)' }}>
          <Spinner />
        </div>
      )}
      <div ref={containerRef} data-testid="stripe-embedded-checkout" />
    </div>
  );
}
