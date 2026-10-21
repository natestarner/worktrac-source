// How this copy of Huddle may sell a plan, resolved from where it is running:
//
//   'embedded'  the web (any browser, installed PWA included): exactly today's embedded Stripe
//               checkout and Customer Portal.
//   'external'  the App Store app on the US storefront: Apple allows a link out to a web checkout
//               there, so "Upgrade" opens Stripe's hosted page in the phone's browser.
//   'none'      the App Store app anywhere else, or wherever the storefront can't be read: no
//               price, no purchase button, no upgrade link and no portal. Apple requires In-App
//               Purchase for digital subscriptions on every other storefront, and we don't offer it.
//
// ⚠️ FAILS CLOSED. Until the storefront answers -- and if it never does -- the app is 'none'. A
// purchase button shown to a non-US account is an App Review rejection; a missing one costs a US
// person a second, until the answer arrives.
//
// The storefront is the App Store ACCOUNT's country (StoreKit), never the device region, language
// or IP: that is what Apple's rule is about. Android has no storefront plugin yet and is 'none'.
import { registerPlugin } from '@capacitor/core';
import { isNativeApp, nativePlatform } from './platform';

// The app's own StoreKit plugin (ios/App/App/StorefrontPlugin.swift). Registered on first use, only
// ever inside the App Store app -- the web never touches it.
let storefront = null;
function storefrontPlugin() {
  if (!storefront) storefront = registerPlugin('Storefront');
  return storefront;
}

export const WEB_CHANNEL = 'embedded';

// Synchronous first answer, so the web renders today's billing screen on its first frame with no
// flash, and the app starts closed.
export function initialBillingChannel() {
  return isNativeApp() ? 'none' : WEB_CHANNEL;
}

let resolved = null;

export async function resolveBillingChannel() {
  if (!isNativeApp()) return WEB_CHANNEL;
  if (resolved) return resolved;
  if (nativePlatform() !== 'ios') {
    resolved = 'none';
    return resolved;
  }
  try {
    const { countryCode } = await storefrontPlugin().getCountryCode();
    resolved = countryCode === 'USA' ? 'external' : 'none';
  } catch (error) {
    // Unreadable storefront -> no purchase UI, and asked again next time rather than cached, in
    // case it was transient (StoreKit can be briefly unavailable right after install).
    console.warn('Storefront unavailable; showing no purchase options.', error);
    return 'none';
  }
  return resolved;
}

// For tests: forget the cached answer.
export function resetBillingChannelForTests() {
  resolved = null;
}
