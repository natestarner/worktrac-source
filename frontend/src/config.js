let config = null;

// Bounded on purpose. This fetch runs in main.jsx BEFORE createRoot().render() is ever called --
// nothing, not even AppShellSkeleton, paints until it settles one way or the other. A rejected
// fetch (hard offline, DNS failure) already fell back fine; what had no bound at all was a
// connection to THIS APP'S OWN static host that's merely slow rather than actually failing --
// lie-fi to the frontend origin itself, which nothing else in the app watches for
// (reachabilityMonitor only instruments /api/* calls, and a hard-offline device fails this fetch
// fast, not slowly). Left unbounded, that left React with nothing to mount for an unbounded time.
//
// 5s, comfortably inside boot-watchdog.js's GRACE_MS (7s) -- a config fetch this slow still lets
// AppShellSkeleton paint well before the watchdog would ever consider stepping in. See
// docs/incidents/2026-08-31-boot-white-screen-recurrence.md for the investigation that found this.
const CONFIG_FETCH_TIMEOUT_MS = 5000;

// The device's last successfully-fetched apiUrl, kept in localStorage (survives a reload; see
// frontend-core.md's "written SYNCHRONOUSLY" rule -- same reasoning applies here even though this
// isn't in-progress UI state, because the failure this exists to prevent happens on exactly the
// forced-reload this app deliberately can't avoid). NOT the same key space as appStatePersistence
// -- this has nothing to do with a person or a schema version, just "what origin actually worked
// last time".
const LAST_KNOWN_API_URL_KEY = 'worktrac-last-known-api-url';

function readLastKnownApiUrl() {
  try {
    return localStorage.getItem(LAST_KNOWN_API_URL_KEY) ?? '';
  } catch {
    // Storage unavailable (private mode, quota, disabled) -- degrade to the local-dev-safe empty
    // fallback below rather than throwing out of loadConfig().
    return '';
  }
}

function writeLastKnownApiUrl(apiUrl) {
  try {
    localStorage.setItem(LAST_KNOWN_API_URL_KEY, apiUrl ?? '');
  } catch {
    // Same as above -- this is a convenience cache, not a durability requirement; losing a write
    // just means the NEXT failure falls back to relative paths instead of the real origin.
  }
}

export async function loadConfig() {
  if (config) return config;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/config.json', { signal: controller.signal });
    if (!response.ok) throw new Error(`/config.json responded ${response.status}`);
    config = await response.json();
    writeLastKnownApiUrl(config.apiUrl);
  } catch {
    // Covers a real rejection, a non-2xx response, and the abort above alike -- boot must not
    // wait to find out which.
    //
    // Falling back to a RELATIVE path here is only safe in local dev, where the Vite proxy makes
    // '/api/...' resolve to the real backend. In every deployed environment this app's own static
    // host has no /api/* route at all (see staticwebapp.config.json -- there is no backend link,
    // only the absolute apiUrl this fetch is trying to read), so an empty apiUrl silently sends
    // every subsequent call for the rest of THIS page's life -- login included -- to the wrong
    // origin, which answers with a real, fulfilled 404/405. That's a genuine response, not an
    // offline-shaped one, so none of the app's degraded-conditions machinery (isOfflineError,
    // the outbox, AuthContext's snapshot fallback) ever engages; it just fails, quietly, forever,
    // until the person happens to reload again. This is reproducible on literally the FIRST
    // navigation after a service-worker update -- see
    // docs/incidents/2026-08-31-boot-white-screen-recurrence.md's follow-up investigation.
    //
    // The fix: fall back to the last apiUrl THIS DEVICE successfully fetched, not to relative
    // paths. It is written on every success above, survives reload (localStorage, not the query
    // cache's IndexedDB persister), and for a returning user is virtually always still correct --
    // apiUrl changes only when this environment's backend is redeployed to a new hostname, which
    // has never happened and would itself need a new frontend deploy alongside it. Only a device
    // that has genuinely never loaded this app before falls through to the empty/relative
    // fallback, which is also exactly what local dev's own config.json (apiUrl: "") produces.
    config = { apiUrl: readLastKnownApiUrl() };
  } finally {
    clearTimeout(timeoutId);
  }
  return config;
}

export function getApiUrl(path) {
  if (!config || !config.apiUrl) return path;
  return `${config.apiUrl}${path}`;
}
