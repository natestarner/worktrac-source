import { hasInFlightWrite } from './pendingWrites';

// Single source of truth for "is a new service-worker version available, and how do we apply it" --
// kept separate from main.jsx (which isn't unit-tested; its `virtual:pwa-register` import resolves
// to a no-op in `vite dev` and is excluded from the Vitest bundle entirely) so every consumer --
// the ServiceWorkerUpdater banner AND the forced-reload triggers in AppShell.jsx/LogTab.jsx --
// shares one signal instead of each reaching into their own copy of `window.__pwaUpdateSW`.

// Every ~1h, plus whenever the tab regains visibility -- see startUpdatePolling. Workbox's own
// guidance: the browser only checks for a new sw.js on navigation, so a tab left open for a long
// time (laptop sleep, background tab) would otherwise not notice a deploy for an unbounded time.
export const POLL_INTERVAL_MS = 60 * 60 * 1000;

let updateFn = null;
let available = false;
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener(available));
}

// Called once from main.jsx's registerSW({ onNeedRefresh }) callback, with the `updateSW` function
// vite-plugin-pwa hands back (calling it with `true` skips waiting and reloads once the new worker
// takes control).
export function markUpdateAvailable(fn) {
  updateFn = fn;
  available = true;
  notify();
}

export function isUpdateAvailable() {
  return available;
}

export function subscribeUpdateAvailable(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Unconditional apply -- used by the banner's manually-clicked "Reload", where the user themselves
// is the safety check (they wouldn't click it mid-tap on something else).
export function applyUpdate() {
  if (!updateFn) return;
  updateFn(true);
}

// Guarded apply -- used by the automatic forced-reload triggers (person/section/exercise switch,
// ending a workout, regaining tab visibility). Applies the pending update UNLESS there's a write
// for this person that's currently in flight and not yet durable (see pendingWrites.js), in which
// case it's skipped for now -- the banner (if the user has meanwhile also gotten a needrefresh
// notification) or the next trigger remains available to apply it later. Returns whether it
// actually applied, mainly so tests can assert on it.
export function tryForceUpdate(queryClient, personId) {
  if (!available) return false;
  if (hasInFlightWrite(queryClient, personId)) return false;
  applyUpdate();
  return true;
}

// Periodically re-checks for a new service-worker version. `registration.update()` is a no-op
// (resolves without error) if nothing's changed, and it's what makes onNeedRefresh fire even when
// the user never triggers a fresh navigation. Also re-checks the instant a backgrounded tab
// becomes visible again, since that's both a very natural low-risk moment for a check and often
// coincides with a long idle gap (the most likely time to be stale). Returns a cleanup function.
export function startUpdatePolling(registration) {
  if (!registration) return () => {};
  const check = () => registration.update().catch(() => {});
  const intervalId = setInterval(check, POLL_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

// Test-only reset.
export function __resetSwUpdateForTests() {
  updateFn = null;
  available = false;
  listeners.clear();
}
