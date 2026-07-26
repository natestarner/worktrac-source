import { onlineManager } from '@tanstack/react-query';

// User-initiated offline mode: the manual override for the connection-trouble case automatic
// detection can't see (see reachabilityMonitor.js) -- gym wifi behind a captive portal, a dead
// upstream, flaky cellular. Pinning drives `onlineManager` directly, which is the single signal
// every consumer already reads (useOnlineStatus, OfflineBanner, the durable outbox's
// resume-on-reconnect in App.jsx, log-set's paused-row UI in ExerciseDetail.jsx) -- so pinning
// makes the whole app behave exactly as if it were hard-offline, with no new plumbing anywhere
// else. Device-global (localStorage, no personId): connectivity is a property of the device, not
// of whichever person is currently active.
const STORAGE_KEY = 'worktrac-offline-pinned';

// TanStack's own default online/offline event wiring isn't exported standalone (it's a private
// closure inside OnlineManager's constructor), so it's reproduced here -- this is the exact
// behavior `onlineManager.setEventListener` installs by default (window `online`/`offline`
// events flip `setOnline`), needed so unpinning can restore it verbatim.
function defaultOnlineEventSetup(setOnline) {
  if (typeof window === 'undefined' || !window.addEventListener) return undefined;
  const onlineListener = () => setOnline(true);
  const offlineListener = () => setOnline(false);
  window.addEventListener('online', onlineListener);
  window.addEventListener('offline', offlineListener);
  return () => {
    window.removeEventListener('online', onlineListener);
    window.removeEventListener('offline', offlineListener);
  };
}

// While pinned, browser online/offline events must NOT reach `onlineManager` -- otherwise the
// very next network blip (or the browser's own 'online' event firing right after the user pinned)
// would silently un-pin them. This is what makes the pin actually stick.
function suspendedEventSetup() {
  return undefined;
}

function currentNavigatorOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

let pinned = false;
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener(pinned));
}

export function pinOffline() {
  if (pinned) return;
  pinned = true;
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Private-mode / quota / disabled storage: the pin still works for this session, it just
    // won't survive a reload.
  }
  onlineManager.setEventListener(suspendedEventSetup);
  onlineManager.setOnline(false);
  notify();
}

// Never called automatically on "looks reachable again" -- see useOfflineRecoveryHeartbeat.js.
// Only the user (via the recovery prompt or the Settings toggle) unpins, so a flaky connection
// can't flap the app in and out of offline mode on its own.
export function unpinOffline() {
  if (!pinned) return;
  pinned = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  onlineManager.setEventListener(defaultOnlineEventSetup);
  onlineManager.setOnline(currentNavigatorOnline());
  notify();
}

export function isOfflinePinned() {
  return pinned;
}

export function subscribeOfflinePin(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Applied once at module load (see App.jsx's boot-time import) so a pin from a previous session
// takes effect before the app's first query/mutation ever fires -- not after some component
// happens to mount and read it. Exported so a test can exercise it directly rather than relying on
// import-time evaluation order.
export function applyPersistedPin() {
  let wasPinned = false;
  try {
    wasPinned = localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    wasPinned = false;
  }
  if (wasPinned) {
    pinOffline();
  } else {
    // onlineManager defaults to `true` and only updates on window online/offline EVENTS, which
    // don't fire on a fresh load that's already offline -- so a boot-while-offline is otherwise
    // misdetected as online (the offline banner stays suppressed, and a set logged before the
    // first event ever fires runs-and-fails online instead of pausing durably). Seed it from the
    // real navigator state here; the default event listener still attaches on first subscribe and
    // handles every later transition normally.
    onlineManager.setOnline(currentNavigatorOnline());
  }
}
applyPersistedPin();

// Test-only: undo the pin and restore the default listener without touching localStorage.
export function __resetOfflineModeForTests() {
  pinned = false;
  listeners.clear();
  onlineManager.setEventListener(defaultOnlineEventSetup);
}
