import { useEffect, useState } from 'react';
import { initialBillingChannel, resolveBillingChannel } from '../lib/native';

// 'embedded' | 'store' | 'none' -- how this copy of Huddle may sell a plan
// (lib/native/billingChannel.js has the rules). Known synchronously, so every surface renders its
// final state on its first frame. Whether the store actually has something to sell is a separate
// question, answered (and failed closed) by hooks/useStoreCatalog on the billing screen.
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
