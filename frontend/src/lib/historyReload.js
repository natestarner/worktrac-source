// How a person asks for their whole History again. The History sync trusts every month whose
// fingerprint matches (lib/historySync.js) and nothing re-downloads everything on a timer, so this is
// the one way to say "whatever you hold, fetch it all again" -- the web's own convention for it:
//
//   - RELOADING the page while on History (the browser's reload button or shortcut, or the pull down
//     to refresh a mobile browser does natively). Read here, once per page load.
//   - PULLING DOWN at the top of History in the installed app, which has no browser reload and no
//     native pull to refresh (components/history/PullToRefresh.jsx).
//
// Either one re-downloads the ACTIVE person's History only: refreshHistory(..., { full: true }).
// A reload the app starts itself (a service-worker update) counts too when it lands on History; that
// is an occasional extra download, never a wrong one.

// The URL this document was LOADED at, read once while the bundle evaluates -- before React renders,
// so before the router can redirect or a tab switch can change it. Asking location later would be
// wrong: by the time History mounts, location.pathname is /app/history after an ordinary tab switch.
//
// ⚠️ Not the navigation entry's `name`, which this used to read. In Safari, when the service worker
// answers the navigation (Workbox's navigateFallback), `name` is the RESPONSE's URL, `/index.html`, so
// a reload on History never matched and silently did an ordinary sync instead (#431). Chrome reports
// the document URL there, which is how it went unnoticed until the suite ran in WebKit with a worker.
//
// This only holds while this module is in the STATIC import graph (it is: HistoryTab, eagerly
// imported by App.jsx). If History is ever lazy-loaded, capture this in main.jsx instead.
const LOADED_URL = String(globalThis.location?.href ?? '');

// Whether this page load was a reload of the History tab.
export function isHistoryReload(entry, loadedUrl = LOADED_URL) {
  return entry?.type === 'reload' && HISTORY_URL.test(String(loadedUrl));
}

// scheme://host/app/history, optionally with a trailing slash, a query or a hash.
const HISTORY_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/app\/history\/?(?:[?#]|$)/i;

function navigationEntry() {
  return globalThis.performance?.getEntriesByType?.('navigation')?.[0];
}

let taken = false;

// True the FIRST time it is asked on a page load that was a reload of History, false ever after --
// so a History tab that mounts again later (a person switch, a tab switch back) does not re-download.
export function takeHistoryReload(entry = navigationEntry(), loadedUrl = LOADED_URL) {
  if (taken) return false;
  taken = true;
  return isHistoryReload(entry, loadedUrl);
}

// Test seam: each test is a fresh "page load".
export function resetHistoryReloadForTest() {
  taken = false;
}
