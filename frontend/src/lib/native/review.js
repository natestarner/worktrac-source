// Asking for an App Store rating. Only the App Store app has anything to ask: on the web both
// functions do nothing, which is exactly what ran before the app existed.
//
// The request goes to Apple's own sheet (ios/App/App/AppReviewPlugin.swift), never to a screen of
// ours first. Guideline 5.6.1 requires Apple's API for rating requests, and a "Do you enjoy
// Huddle?" step that sends only the happy ones on is review gating. WHEN to ask is decided in
// lib/reviewPrompt.js; whether anything appears is decided by iOS (at most three times a year).
import { registerPlugin } from '@capacitor/core';
import { isNativeApp, nativePlatform } from './platform';

// The app's own plugin, registered on first use and only ever inside the App Store app.
let appReview = null;
function appReviewPlugin() {
  if (!appReview) appReview = registerPlugin('AppReview');
  return appReview;
}

/**
 * Asks iOS to show the rating sheet. Resolves true when the request was made (which is not the same
 * as the sheet appearing: iOS reports nothing back), false on the web or if it could not be made.
 * Never throws: a rating request is never worth an error in front of anyone.
 */
export async function requestAppReview() {
  if (!isNativeApp() || nativePlatform() !== 'ios') return false;
  try {
    const { requested } = await appReviewPlugin().requestReview();
    return requested === true;
  } catch (error) {
    console.warn('Could not ask for an App Store rating.', error);
    return false;
  }
}

/**
 * The App Store's "write a review" page for this app, from the listing URL the server hands out
 * (`/me`'s `client.appStoreUrl`), or null where there is nothing to link to: on the web, and while
 * the listing URL isn't configured.
 */
export function appReviewUrl(storeUrl) {
  if (!isNativeApp() || nativePlatform() !== 'ios' || !storeUrl) return null;
  try {
    const url = new URL(storeUrl);
    url.searchParams.set('action', 'write-review');
    return url.toString();
  } catch {
    return null;
  }
}
