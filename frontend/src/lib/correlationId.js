// A stable per-install id sent on every API request, put into the backend's MDC by
// RequestDiagnosticsFilter, and stored alongside any Contact Us submission. It is what turns "a
// bug report with a timestamp" into "this person's exact request trail" -- paste it into the Log
// Analytics query in docs/azure-read-only-access.md.
//
// PER INSTALL, not per boot. The useful question at triage time is "what was happening to them in
// the minutes before they wrote in", and that regularly spans the reload swUpdate.js performs
// silently after every deploy. A per-boot id would sever the trail at exactly the reload most
// likely to be involved.
//
// localStorage, read at module load, for the same reason offlineMode.js's pin uses it: it must
// survive an uncontrolled teardown, and it is small and synchronous. It is NOT a tracking
// identifier in any sense the app doesn't already have -- every request it rides on already
// carries an authenticated user's bearer token.
const STORAGE_KEY = 'worktrac-correlation-id';

function generate() {
  // crypto.randomUUID is unavailable on non-secure origins (plain-http LAN testing on an iPad, for
  // one), so fall back rather than throwing. The value only has to be unique enough to filter a log
  // query by; it is never a security boundary.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function load() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = generate();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Private mode, quota, or storage disabled entirely. Degrade to a value that lives only as
    // long as this page session: correlation within one session still works, it just doesn't
    // survive a reload. Never let diagnostics plumbing be able to break the app.
    return generate();
  }
}

const correlationId = load();

export function getCorrelationId() {
  return correlationId;
}
