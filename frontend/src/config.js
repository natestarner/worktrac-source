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

export async function loadConfig() {
  if (config) return config;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch('/config.json', { signal: controller.signal });
    config = await response.json();
  } catch {
    // Covers a real rejection AND the abort above -- either way, boot must not wait to find out
    // which. Relative paths (empty apiUrl) are the same safe fallback this already had.
    config = { apiUrl: '' };
  } finally {
    clearTimeout(timeoutId);
  }
  return config;
}

export function getApiUrl(path) {
  if (!config || !config.apiUrl) return path;
  return `${config.apiUrl}${path}`;
}
