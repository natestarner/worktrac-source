// Universal links: a link to app.huddle.fitness (an invitation, "Open Huddle" in an email) that iOS
// hands to the installed app instead of Safari. The site's half of that handshake is
// public/.well-known/apple-app-site-association.json; the app's is App.entitlements.
//
// Web: nothing to do. A browser follows the link itself, so there is no listener at all.
// App: the link arrives as `appUrlOpen` while the app is running, or as the launch URL when it
// started the app (that event can fire before anything listens). Either way it becomes an in-app
// path for the router, so /join?i=... lands on the Join screen with the invitation intact.
import { isNativeApp } from './platform';

// The two web apps whose links an app build may route. A link anywhere else (the marketing site, a
// lookalike host) is ignored rather than opened as an in-app path.
const APP_HOSTS = new Set(['app.huddle.fitness', 'app.dev.huddle.fitness']);

// iOS can report a cold-start link both ways; the second report within this window is the same tap.
const SAME_TAP_MS = 2000;

export function appPathForUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !APP_HOSTS.has(parsed.hostname)) return null;
  // Stripe's hosted checkout lands on a page that says "go back to the Huddle app". Opened IN the
  // app that is nonsense, so take them to the billing screen's own reconcile instead, exactly as a
  // web checkout ends.
  if (parsed.pathname === '/checkout-complete') {
    const session = parsed.searchParams.get('session_id');
    return session ? `/app/billing?checkout=${encodeURIComponent(session)}` : '/app/billing';
  }
  return parsed.pathname + parsed.search + parsed.hash;
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
