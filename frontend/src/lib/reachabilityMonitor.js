// Tracks whether real API calls are actually reaching a server -- a signal `navigator.onLine`
// (and therefore TanStack's `onlineManager`) structurally cannot provide. `navigator.onLine`
// only reflects whether SOME network interface is up; it stays "online" on gym wifi behind a
// captive portal, a dead upstream, or flaky cellular where every request quietly times out.
// api/client.js reports the outcome of every request here. A single failure never counts (a
// one-off blip is normal) -- only CONSECUTIVE_FAILURE_THRESHOLD in a row flips `trouble`, and ANY
// completed response (even a 4xx/5xx -- the server answered, so this device's network path is
// fine) resets the count to zero. This is what lets the UI suggest manual offline mode
// (ConnectionTroubleBanner) for exactly the case automatic detection can't see.
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

let consecutiveFailures = 0;
let trouble = false;
const listeners = new Set();

function setTrouble(next) {
  if (trouble === next) return;
  trouble = next;
  listeners.forEach((listener) => listener(trouble));
}

function recordSuccess() {
  consecutiveFailures = 0;
  setTrouble(false);
}

function recordFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) setTrouble(true);
}

function isTrouble() {
  return trouble;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const reachabilityMonitor = {
  recordSuccess,
  recordFailure,
  isTrouble,
  subscribe,
};

// Test-only: a failure count from one test must never bleed into the next.
export function __resetReachabilityForTests() {
  consecutiveFailures = 0;
  trouble = false;
  listeners.clear();
}
