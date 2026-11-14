// In-App Purchase: the ONLY place the app talks to a store. Same calls on every platform; each
// platform's `Purchases` plugin implements them (iOS: ios/App/App/PurchasesPlugin.swift on StoreKit
// 2; Android, later, on Play Billing). Nothing above this file knows which store it is -- it gets
// the store's name and URL segment from storeName() / storeSource(), and the store's own prices from
// getProducts(). docs/in-app-purchase-plan.md.
//
// Web branch: there is no store. storeSource() is null, so the billing channel is 'embedded' and
// nothing here is ever called; each function below still answers safely if it were.
//
// A "proof" is { proof, transactionId }: what the store says happened (Apple: the transaction's
// signed JWS), sent to our backend unopened. The backend verifies it with the store and decides; this
// file never decides whether anything was bought. A transaction is finish()ed only after the backend
// answered 2xx for it -- until then the store keeps handing it back, which is the retry mechanism.
import { registerPlugin } from '@capacitor/core';
import { isNativeApp, nativePlatform } from './platform';

let purchases = null;
function purchasesPlugin() {
  if (!purchases) purchases = registerPlugin('Purchases');
  return purchases;
}

// Which store this copy of the app sells through, as the backend's URL names it
// (/api/billing/store/{source}/...). Null where there is no store: the web, and any platform whose
// plugin doesn't exist yet. Android becomes 'google-play' here, and nowhere else changes.
export function storeSource() {
  if (!isNativeApp()) return null;
  return nativePlatform() === 'ios' ? 'app-store' : null;
}

// How a person would name each billing source, keyed by the backend's BillingSource. One map for the
// buy screen and for "billed through ..." (SubscriptionDto.billingSource).
const SOURCE_NAMES = {
  STRIPE: 'huddle.fitness',
  APP_STORE: 'the App Store',
  GOOGLE_PLAY: 'Google Play',
};

export function billingSourceName(billingSource) {
  return SOURCE_NAMES[billingSource] ?? null;
}

// The BillingSource of THIS app's store ('APP_STORE'), to compare with SubscriptionDto.billingSource.
export function storeBillingSource() {
  const source = storeSource();
  if (source === 'app-store') return 'APP_STORE';
  if (source === 'google-play') return 'GOOGLE_PLAY';
  return null;
}

/**
 * The store's own description of each product -> [{ id, displayName, displayPrice, periodUnit,
 * periodValue }]. `displayPrice` is the store's localized string ("$29.99"); the app shows it as is.
 * A product the store doesn't know is simply missing. Throws if the store can't be reached.
 */
export async function getProducts(productIds) {
  if (!storeSource()) return [];
  const { products } = await purchasesPlugin().getProducts({ productIds });
  return products ?? [];
}

/**
 * Opens the store's purchase sheet. Resolves:
 *   { result: 'purchased', proof, transactionId }
 *   { result: 'pending' }    Ask to Buy or a bank's approval: it arrives later via onTransaction
 *   { result: 'cancelled' }
 * Throws when the store refused outright (unknown product, payments disabled).
 */
export async function purchase({ productId, accountToken }) {
  if (!storeSource()) return { result: 'cancelled' };
  return purchasesPlugin().purchase({ productId, accountToken });
}

/** Restore Purchases: every current subscription on this store account, as proofs. */
export async function restore() {
  if (!storeSource()) return [];
  const { proofs } = await purchasesPlugin().restore();
  return proofs ?? [];
}

/** Every transaction the store holds unfinished, as proofs. */
export async function unfinishedTransactions() {
  if (!storeSource()) return [];
  const { proofs } = await purchasesPlugin().unfinished();
  return proofs ?? [];
}

/** Marks a transaction handled. Call only after the backend answered 2xx for its proof. */
export async function finish(transactionId) {
  if (!storeSource() || !transactionId) return;
  await purchasesPlugin().finish({ transactionId });
}

/**
 * The store's own manage-subscription screen: change plan, switch period, cancel. Resolves
 * { result: 'shown' } or { result: 'unavailable' } -- the iPad app running on a Mac, where Apple says
 * not to show the sheet; the caller says where to manage it instead.
 */
export async function manageSubscriptions() {
  if (!storeSource()) return { result: 'unavailable' };
  return (await purchasesPlugin().manageSubscriptions()) ?? { result: 'shown' };
}

// Apple's own page for managing subscriptions, for where its sheet can't be shown: the web, and the
// iPad app on a Mac. From Apple's account-deletion guidance ("provide this link to let people manage
// their subscriptions").
export const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * The store's own refund-request sheet for this store account's current subscription. Resolves
 * { result: 'requested' | 'cancelled' | 'none' } ('none': this store account holds no subscription
 * here). The store decides; a granted refund reaches our backend as the store's own notification.
 */
export async function requestRefund() {
  if (!storeSource()) return { result: 'none' };
  return purchasesPlugin().requestRefund();
}

/**
 * Transactions that arrive with no purchase screen open: renewals, Ask to Buy approvals, a purchase
 * on another device. Returns an unsubscribe function. No-op on the web.
 */
export function onTransaction(callback) {
  if (!storeSource()) return () => {};
  const handle = purchasesPlugin().addListener('transaction', callback);
  return () => {
    Promise.resolve(handle).then((h) => h?.remove?.()).catch(() => {});
  };
}
