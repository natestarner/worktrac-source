// Universal links: a link to app.huddle.fitness (an invitation, "Open Huddle" in an email) that iOS
// hands to the installed app instead of Safari. The site's half of that handshake is
// public/.well-known/apple-app-site-association.json; the app's is App.entitlements.
//
// Web: nothing to do. A browser follows the link itself, so there is no listener at all.
// App: the link arrives as `appUrlOpen` while the app is running, or as the launch URL when it
// started the app (that event can fire before anything listens). Either way it becomes an in-app
// path for the router, so /join?i=... lands on the Join screen with the invitation intact.
import { isNativeApp } from './platform';

// The two web apps whose links an app build may route, each with the URL scheme of the app that
// claims it. A link anywhere else (the marketing site, a lookalike host) is ignored rather than
// opened as an in-app path.
//
// The scheme IS the app's bundle id: Info.plist registers $(PRODUCT_BUNDLE_IDENTIFIER), which the
// Fastfile sets per variant, so Huddle and Huddle Lower installed side by side never claim each
// other's links.
const APP_SCHEMES = new Map([
  ['app.huddle.fitness', 'fitness.huddle.app'],
  ['app.dev.huddle.fitness', 'fitness.huddle.app.lower'],
]);
const SCHEMES = new Set(APP_SCHEMES.values());

// iOS can report a cold-start link both ways; the second report within this window is the same tap.
const SAME_TAP_MS = 2000;

// Stripe's hosted checkout lands on a page that says "go back to the Huddle app". Opened IN the
// app that is nonsense, so take them to the billing screen's own reconcile instead, exactly as a
// web checkout ends.
function checkoutReturnPath(searchParams) {
  const session = searchParams.get('session_id');
  return session ? `/app/billing?checkout=${encodeURIComponent(session)}` : '/app/billing';
}

export function appPathForUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // The checkout landing page's "Return to the Huddle app" button (appReturnUrl below). The scheme
  // answers that one link only: anything can open a custom scheme, and nothing else needs one.
  if (SCHEMES.has(parsed.protocol.slice(0, -1))) {
    return parsed.hostname === 'checkout-complete' ? checkoutReturnPath(parsed.searchParams) : null;
  }
  if (parsed.protocol !== 'https:' || !APP_SCHEMES.has(parsed.hostname)) return null;
  if (parsed.pathname === '/checkout-complete') return checkoutReturnPath(parsed.searchParams);
  return parsed.pathname + parsed.search + parsed.hash;
}

// The link that reopens the app from the checkout landing page in Safari, or null on a host no app
// claims (localhost, a preview).
//
// Not the universal link Stripe already redirected to: iOS opens a universal link only when it is
// tapped on ANOTHER site. Stripe's redirect after paying is not a tap, and a tap on this page is a
// link within the same site -- both stay in Safari, which is how the first App Store checkout
// (2026-10-24) ended on this page with no way back but the app switcher. A custom scheme opens the
// app from a tap anywhere, after iOS asks "Open in Huddle?".
export function appReturnUrl(hostname, search) {
  const scheme = APP_SCHEMES.get(hostname);
  return scheme ? `${scheme}://checkout-complete${search}` : null;
}

// ⚠️ Read once per launch, and never again. Capacitor's getLaunchUrl() is not the launch URL: it
// returns the LAST link that opened the app (ApplicationDelegateProxy.lastURL), and nothing ever
// clears it. Asked again later -- AppLinkRouter re-subscribing, say -- it hands back a link the
// person followed minutes ago, and routing it again yanks them back to that screen. Links after
// launch arrive through `appUrlOpen` instead.
let launchUrlRead = false;

export function resetLaunchUrlForTests() {
  launchUrlRead = false;
}

// Calls onPath(path) for each link that opens the app. Returns a function that stops listening.
export function listenForAppLinks(onPath) {
  if (!isNativeApp()) return () => {};

  let stopped = false;
  let handle = null;
  let last = { url: null, at: 0 };

  const deliver = (url) => {
    if (stopped || !url) return;
    const now = Date.now();
    if (url === last.url && now - last.at < SAME_TAP_MS) return;
    const path = appPathForUrl(url);
    if (!path) return;
    last = { url, at: now };
    onPath(path);
  };

  (async () => {
    try {
      const { App } = await import('@capacitor/app');
      if (stopped) return;
      const listener = await App.addListener('appUrlOpen', (event) => deliver(event.url));
      if (stopped) listener.remove();
      else handle = listener;
      if (launchUrlRead) return;
      launchUrlRead = true;
      const launch = await App.getLaunchUrl();
      deliver(launch?.url);
    } catch {
      // The plugin failed to load or answer. The app then simply opens where it would have opened
      // anyway (the last screen, or Log), which is what a tap on the app icon does. Nothing is
      // written or lost; only the link's destination is.
    }
  })();

  return () => {
    stopped = true;
    handle?.remove();
  };
}
