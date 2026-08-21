// A one-slot, local stash of the most recent render-time error, written by ErrorBoundary and read
// by the Contact Us form.
//
// THIS IS NOT AN ERROR REPORTING PIPELINE, and the distinction is the whole reason it is allowed to
// exist. Nothing here transmits anything: no network call, no service, no background beacon. The
// value leaves the device only when a person opens Contact Us, sees it listed in the "What gets
// sent" disclosure, and chooses to send the message. ErrorBoundary's own header used to rule out
// wiring it to "any reporting service" -- that still stands, and adding one is still out of scope.
//
// Why it is worth having at all: a render-time throw is caught by the boundary and never reaches
// Azure in any form. For a bug report, this is frequently the only record that the failure
// happened at all.
//
// localStorage rather than memory because the person's next action after a crashed screen is very
// often a reload -- an in-memory stash would be empty by the time they got to the form.
const STORAGE_KEY = 'worktrac-last-client-error';

// Bounded well under the backend's 2000-char column so a long React stack can never be the reason
// a submission is rejected.
const MAX_STACK_CHARS = 1200;

export function recordClientError(error, info) {
  try {
    const payload = {
      message: String(error?.message ?? error ?? 'Unknown error').slice(0, 400),
      stack: String(info?.componentStack ?? error?.stack ?? '').trim().slice(0, MAX_STACK_CHARS),
      route: typeof window === 'undefined' ? null : window.location?.pathname ?? null,
      at: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable, or an error object that won't serialize. Diagnostics are a nice-to-have;
    // they must never be able to turn a contained render error into a second failure.
  }
}

export function readClientError() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearClientError() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as above.
  }
}

// The single string shape sent to the backend and shown in the disclosure, so the two can never
// disagree about what was actually captured.
export function formatClientError(entry) {
  if (!entry) return null;
  const when = entry.at ? `${entry.at} ` : '';
  const where = entry.route ? `on ${entry.route}` : '';
  return `${when}${where}\n${entry.message}\n${entry.stack}`.trim();
}
