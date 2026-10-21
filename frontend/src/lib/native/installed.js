// "Is Huddle running as an installed app?" -- true for the home-screen PWA and for the App Store
// app alike.
//
// History's pull-to-refresh turns on only for installed apps, because a browser's own pull already
// reloads the page. The App Store app is not in `display-mode: standalone` (that media query is a
// PWA concept), so without the native half the gesture would silently vanish there -- and WKWebView
// has no pull-to-refresh of its own to stand in for it.
import { isNativeApp } from './platform';

export function isInstalledApp() {
  if (isNativeApp()) return true;
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches === true || window.navigator.standalone === true;
  } catch {
    return false;
  }
}
