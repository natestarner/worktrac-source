// The one place that asks "is this the App Store / Play app, or a browser?".
//
// lib/native/ is the ONLY directory allowed to import @capacitor/* (scripts/
// check-resilience-invariants.sh fails the build otherwise). Everything else calls a small function
// exported from here whose web branch is exactly the code that ran before the app existed -- so a
// component never branches on platform itself, and the web keeps one code path.
//
// @capacitor/core is the only Capacitor package the web bundle carries: on the web
// isNativePlatform() is a constant false. Plugins are imported lazily, inside the native branch of
// each function, so none of them is downloaded by a browser.
import { Capacitor } from '@capacitor/core';

/** True inside the iOS/Android app shell; false in every browser, installed PWA included. */
export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/** 'ios' | 'android' | 'web'. */
export function nativePlatform() {
  return Capacitor.getPlatform();
}
