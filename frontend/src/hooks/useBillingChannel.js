import { useEffect, useState } from 'react';
import { initialBillingChannel, resolveBillingChannel } from '../lib/native';

// 'embedded' | 'external' | 'none' -- how this copy of Huddle may sell a plan
// (lib/native/billingChannel.js has the rules). The web is 'embedded' from its first render, so
// every billing surface there renders exactly as before. The App Store app starts at 'none' and
// moves to 'external' only once the storefront says US: it fails closed, never open.
//
// Read by the upgrade surfaces themselves (PlusUpsell, PlanBadge, BillingTab, LoginsSection,
// HistoryWindowModal), never by their callers -- so "one way to ask for an upgrade" also means one
// place that decides whether asking is allowed.
export function useBillingChannel() {
  const [channel, setChannel] = useState(initialBillingChannel);
  useEffect(() => {
    let alive = true;
    resolveBillingChannel().then((next) => {
      if (alive) setChannel(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return channel;
}
