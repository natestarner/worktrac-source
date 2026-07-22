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
const SNAPSHOT_VERSION = 1;

export function saveAuthSnapshot({ user, account, people }) {
  try {
    localStorage.setItem(
      AUTH_SNAPSHOT_KEY,
      JSON.stringify({ v: SNAPSHOT_VERSION, user, account, people }),
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
    if (!parsed || parsed.v !== SNAPSHOT_VERSION || !parsed.user) return null;
    return { user: parsed.user, account: parsed.account, people: parsed.people || [] };
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
