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

// Whether this page load was a reload of the History tab. The navigation entry's `name` is the URL the
// document was LOADED at, so this is right whenever it is asked: History's chunk may load long after a
// reload of another tab, by which time location.pathname is /app/history for an ordinary tab switch.
export function isHistoryReload(entry) {
  if (!entry || entry.type !== 'reload') return false;
  try {
    return /^\/app\/history\/?$/.test(new URL(entry.name).pathname);
  } catch {
    return false;
  }
}

function navigationEntry() {
  try {
    return performance.getEntriesByType('navigation')[0];
  } catch {
    return undefined;
  }
}

let taken = false;

// True the FIRST time it is asked on a page load that was a reload of History, false ever after --
// so a History tab that mounts again later (a person switch, a tab switch back) does not re-download.
export function takeHistoryReload(entry = navigationEntry()) {
  if (taken) return false;
  taken = true;
  return isHistoryReload(entry);
}

// Test seam: each test is a fresh "page load".
export function resetHistoryReloadForTest() {
  taken = false;
}
