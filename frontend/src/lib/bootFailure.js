// Reads the record `public/boot-watchdog.js` leaves behind when it fires. Written there rather
// than here because the whole point of the watchdog is that it runs when the bundle this file
// belongs to may never have executed -- see that file's own header.
//
// This is the SAME mechanism as lib/lastClientError.js, deliberately: one local stash, no network,
// carried to the server only if a person opens Contact Us and sends a message that discloses it.
// It is not a second reporting pipeline, and adding one is still out of scope (see
// ErrorBoundary.jsx's header). What it adds is coverage of the failures lastClientError
// structurally cannot see: that one is written by a React error boundary, so it only exists when
// React was alive enough to catch something. A boot that never rendered produces nothing there.
//
// Every access try/catch-swallows for the same reason every other storage module here does:
// private mode, quota and disabled storage must degrade to "no diagnostics", never to a broken
// screen. Diagnostics must never be able to break the app they exist to diagnose.
const STORAGE_KEY = 'worktrac-boot-failure';

export function readBootFailure() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // v is bumped if the shape changes incompatibly; an older record is dropped rather than
    // formatted into something misleading.
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function clearBootFailure() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same reasoning as above.
  }
}

// The single string shape sent to the backend and shown in Contact Us's disclosure, so the two can
// never disagree about what was actually captured. Leads with the discriminator, because
// "did React ever render" is the first question every one of these investigations has had to ask.
export function formatBootFailure(record) {
  if (!record) return null;
  const marks = record.marks || {};
  const reached = Object.keys(marks)
    .map((name) => `${name}@${marks[name]?.atMs}ms${marks[name]?.detail ? `(${marks[name].detail})` : ''}`)
    .join(' ');
  const lines = [
    `boot-failure ${record.at || ''} on ${record.route || '?'} after ${record.waitedMs}ms`,
    record.painted
      ? `painted, then emptied at ${record.emptiedAfterMs}ms  <-- the tree rendered and went away`
      : 'never painted  <-- React committed nothing',
    `reached: ${reached || '(nothing -- the bundle never ran)'}`,
    `readyState=${record.readyState} online=${record.online} visibility=${record.visibility} sw=${record.swController}`,
    record.ua ? `ua=${record.ua}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
