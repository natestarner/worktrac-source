// The last-known identity from a successful GET /api/auth/me, stashed so the app can boot into an
// authenticated state while offline (a valid saved token + a persisted query cache are otherwise
// useless if the bootstrap /me call can't reach the server). Small, non-secret data only -- /me
// returns no password hash or token; the JWT itself lives separately under the api client's key.
//
// localStorage (not IndexedDB) on purpose: the auth bootstrap runs synchronously enough that a
// synchronous read keeps first paint simple, and it mirrors where the token already lives.
const AUTH_SNAPSHOT_KEY = 'worktrac-auth-snapshot';

// Bump if the shape of what we store changes incompatibly, so a stale snapshot is ignored rather
// than fed into the app.
//
// v2 added `membership` (which person this login is, and whether it can see the rest of the
// household). See the adopter in loadAuthSnapshot -- a bump alone would have been a real
// regression.
const SNAPSHOT_VERSION = 2;

export function saveAuthSnapshot({ user, account, people, membership }) {
  try {
    localStorage.setItem(
      AUTH_SNAPSHOT_KEY,
      JSON.stringify({ v: SNAPSHOT_VERSION, user, account, people, membership }),
    );
  } catch {
    // Private-mode / quota / disabled storage: the snapshot is a progressive enhancement, never a
    // hard dependency. Failing to persist it just means offline boot falls back to /login.
  }
}

export function loadAuthSnapshot() {
  try {
    const raw = localStorage.getItem(AUTH_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.user) return null;

    // ⚠️ A v1 snapshot is ADOPTED, not discarded, and that distinction is the whole reason this
    // branch exists. Rejecting it would send every device holding one -- i.e. every existing
    // install, on the first launch after this deploys -- down AuthContext's "no snapshot" path:
    // stay on `loading`, retry with backoff, and after three attempts show "Huddle can't reach
    // the server". For anyone whose first launch after the deploy happens to be offline, that is
    // the stranded-boot shape of docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md,
    // caused by a version bump rather than by a cold backend.
    //
    // `membership: null` means "not known yet". It resolves on the next successful /me, which is
    // the same call that wrote the snapshot in the first place.
    if (parsed.v !== SNAPSHOT_VERSION && parsed.v !== 1) return null;

    return {
      user: parsed.user,
      account: parsed.account,
      people: parsed.people || [],
      membership: parsed.membership || null,
    };
  } catch {
    return null;
  }
}

export function clearAuthSnapshot() {
  try {
    localStorage.removeItem(AUTH_SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}
