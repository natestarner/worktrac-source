// Sending a store's proofs to our backend, and finishing them only once it has them. The ONE path
// for every store transaction the app sees: a purchase just made (BillingTab), Restore Purchases
// (BillingTab), and anything that arrives with no purchase screen open -- a renewal, an Ask to Buy
// approval, a purchase on another device, or one whose confirmation never reached us
// (hooks/useStoreTransactions). docs/in-app-purchase-plan.md.
//
// ⚠️ FINISH ONLY AFTER A 2xx. A finished transaction is gone from the store's queue for good; an
// unfinished one is handed back on the next launch. That queue IS the retry mechanism for purchases
// -- the resilience contract's "queue and retry" -- so there is deliberately no second one here (not
// the durable outbox, which must never hold a payment, and no retry loop): a failed sync just leaves
// the transactions unfinished, and the next sweep sends them again.
import { finish, storeSource } from './native';
import { syncStorePurchases } from '../api/billing';

// The backend takes at most ten proofs per request (StoreBillingController.MAX_PROOFS).
const BATCH = 10;

// One sync at a time: the transaction listener and a foreground sweep can see the same transaction
// in the same second, and sending it twice is harmless but wasteful.
let chain = Promise.resolve();

/**
 * Sends `proofs` ([{ proof, transactionId }]) to the backend and finishes each batch it accepted.
 * Resolves the household's SubscriptionDto from the last batch, or null when there was nothing to
 * send. Rejects when the backend could not take them -- nothing in that batch is finished.
 */
export function syncAndFinish(proofs) {
  const run = chain.then(() => syncAndFinishNow(proofs));
  chain = run.catch(() => {});
  return run;
}

async function syncAndFinishNow(proofs) {
  const store = storeSource();
  const pending = (proofs ?? []).filter((p) => p?.proof);
  if (!store || pending.length === 0) return null;
  let subscription = null;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    subscription = await syncStorePurchases(store, batch);
    for (const item of batch) {
      // A finish that fails is retried by the next sweep (the transaction is still unfinished, and
      // the backend applying it twice changes nothing), so it never fails the sync.
      await finish(item.transactionId).catch(() => {});
    }
  }
  return subscription;
}
