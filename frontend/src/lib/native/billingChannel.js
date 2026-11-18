// How this copy of Huddle may sell a plan, resolved from where it is running:
//
//   'embedded'  the web (any browser, installed PWA included): the embedded Stripe checkout and
//               Customer Portal.
//   'store'     an app whose platform has a store plugin (the App Store app today; Google Play
//               later): In-App Purchase through lib/native/purchases.js. Apple requires a plan that
//               can be used in the app to be sold in the app through its store (guideline 3.1.1), so
//               this is the ONLY way to pay inside the app -- no link out to the web.
//   'none'      an app on a platform with no store plugin yet: no price, no purchase button, no
//               upgrade link and no portal.
//
// 'store' only says which WAY to sell. Whether there is anything to show is decided on the billing
// screen by the store itself: if its products can't be loaded, the screen offers nothing to buy (it
// fails closed, exactly as 'none' does) -- see hooks/useStoreCatalog.
//
// The US-only link-out to Stripe ('external') was this file's third answer until In-App Purchase
// replaced it; App Review rejected it under 3.1.1 (docs/in-app-purchase-plan.md).
import { isNativeApp } from './platform';
import { storeSource } from './purchases';

export const WEB_CHANNEL = 'embedded';

// Synchronous, and final: nothing about the answer is learned later, so every surface renders its
// final state on its first frame.
export function initialBillingChannel() {
  if (!isNativeApp()) return WEB_CHANNEL;
  return storeSource() ? 'store' : 'none';
}

export async function resolveBillingChannel() {
  return initialBillingChannel();
}

// Kept for tests written against the old asynchronous storefront lookup; nothing is cached now.
export function resetBillingChannelForTests() {}
