import { del, get } from 'idb-keyval';

// Per-person in-progress UI state (active routine + position, tab, selected exercise, drafts).
//
// **localStorage, not IndexedDB, and the reason is durability at teardown -- not speed.**
//
// This state's whole job is to survive a reload, and the reload that matters arrives with no
// warning: `swUpdate.js` force-reloads on ordinary navigation whenever a new build exists (i.e.
// always just after a deploy), and a person can tap-then-refresh at any moment. So the write has to
// already be committed when the document is torn down.
//
// An async store cannot promise that. `idb-keyval`'s `set()` resolves a transaction on a later
// task, and there is no way to flush one during teardown -- `pagehide`/`visibilitychange` handlers
// cannot await, which the previous version of this file acknowledged and then tried to outrun by
// writing on every dispatch instead of debouncing. That narrowed the window; it did not close it.
// Measured on 2026-08-14: the commit landed ~3ms after the position painted on an idle dev machine,
// and lost the race often enough on lower that `reload-persistence.spec.ts` failed 38 of 51 runs.
//
// `localStorage.setItem` is synchronous -- once it returns, a subsequent document load reads the
// new value. That removes the race rather than shrinking it. The payload is a few KB of
// JSON-serializable UI state, which is what localStorage is for; `authSnapshot.js` stores the
// identity snapshot here for the same synchronous-read reason.
//
// The trade-off accepted: writes are synchronous on the main thread, and this fires on every
// dispatch (including exercise-search keystrokes). A stringify + set of a few KB is well under a
// millisecond, and correctness at teardown is worth more than that.

// Bump when the persisted per-person UI-state shape changes incompatibly -- a mismatched version is
// discarded rather than hydrated, so an old shape can never crash a new build.
const SCHEMA_VERSION = 1;

const KEY_PREFIX = 'worktrac-appstate-';

// Installs from before this moved to localStorage have their state under the same key name in
// idb-keyval's store. Exported so the migration is testable rather than assumed.
export const LEGACY_IDB_KEY_PREFIX = KEY_PREFIX;

// Marks an account's per-account key as already folded into a per-LOGIN one on this device, so the
// adoption below runs at most once per account per device. See loadAppState for why that bound
// matters.
const MIGRATED_PREFIX = 'worktrac-appstate-migrated:';

// Namespaced by (account, LOGIN) so neither a second household NOR a second member of the SAME
// household restores somebody else's in-progress UI state.
//
// ⚠️ The login half is not cosmetic. `activePersonId` and every `byPerson` draft live in here, so
// under an account-only key a member signing in after a sibling would open on the SIBLING's person
// -- a person they may not even be allowed to write to -- with the sibling's half-typed weight and
// reps in the fields. Same reasoning as outboxPersistence's scope, one tier down in stakes: this
// loses no data, it just shows the wrong person's.
//
// A null userId is a pre-member-logins device on its first authenticated load; it keeps reading the
// per-account key until the next /me supplies an id, which is the state the adoption then migrates.
function keyFor(accountId, userId) {
  return userId == null ? `${KEY_PREFIX}${accountId}` : `${KEY_PREFIX}${accountId}:${userId}`;
}

function migrationDone(accountId) {
  try {
    return localStorage.getItem(`${MIGRATED_PREFIX}${accountId}`) === '1';
  } catch {
    // Unreadable storage means "not migrated", which retries the adoption rather than skipping it.
    // Re-adopting is harmless (the source key is deleted on success); skipping would silently drop
    // a person's restored routine position.
    return false;
  }
}

function markMigrated(accountId) {
  try {
    localStorage.setItem(`${MIGRATED_PREFIX}${accountId}`, '1');
  } catch {
    // Losing the tombstone only means the adoption may be attempted again. Bounded and harmless --
    // see migrationDone.
  }
}

function parse(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== SCHEMA_VERSION) return null;
    return { activePersonId: value.activePersonId ?? null, byPerson: value.byPerson ?? {} };
  } catch {
    // A truncated or hand-edited value must not throw into boot -- treat it as absent.
    return null;
  }
}

// Synchronous by contract. Returns true when the snapshot actually reached storage, which the
// migration below relies on before dropping the legacy copy.
export function saveAppState(accountId, userId, { activePersonId, byPerson }) {
  if (accountId == null) return false;
  try {
    localStorage.setItem(
      keyFor(accountId, userId),
      JSON.stringify({ version: SCHEMA_VERSION, activePersonId, byPerson }),
    );
    return true;
  } catch {
    // Private mode, a disabled store, or quota. Persistence is a progressive enhancement, never a
    // hard dependency -- the app keeps working, it just won't restore after a reload.
    return false;
  }
}

// Async only because of the one-time legacy read below; the common path resolves without ever
// touching IndexedDB.
export async function loadAppState(accountId, userId) {
  if (accountId == null) return null;

  let raw = null;
  try {
    raw = localStorage.getItem(keyFor(accountId, userId));
  } catch {
    // Reading can throw where writing does (a disabled store, some private modes). Losing this
    // error is safe and deliberate: "no restorable state" is exactly the right answer, and it is
    // the same outcome as a first-ever boot. Surfacing it would block boot over an enhancement.
    return null;
  }
  const current = parse(raw);
  if (current) return current;

  // Per-account key -> per-login key. Once only, per account, per device.
  //
  // ⚠️ THE TOMBSTONE IS WHAT STOPS THIS HANDING ONE MEMBER ANOTHER'S SCREEN STATE. The per-account
  // key is shared by the whole household, so without a bound EVERY member signing in on a device
  // that still has one would adopt it -- reintroducing exactly the leak the re-key removes, through
  // the migration meant to preserve state across it.
  //
  // The bound is sound because of WHEN it can fire: at migration time the only login that account
  // has ever had on this device is the one that wrote that state, since member logins did not exist
  // when it was written.
  if (userId != null && !migrationDone(accountId)) {
    try {
      const perAccountRaw = localStorage.getItem(keyFor(accountId, null));
      markMigrated(accountId);
      const perAccount = parse(perAccountRaw);
      if (perAccount) {
        // Same order as the IndexedDB adoption below: only drop the old copy once the new one is
        // definitely written, so a failing write degrades to "still reads the old key" rather than
        // losing the state outright.
        if (saveAppState(accountId, userId, perAccount)) localStorage.removeItem(keyFor(accountId, null));
        return perAccount;
      }
    } catch {
      // Same rationale as migrationDone's: an unreadable store means there is nothing to adopt,
      // which is the same outcome as a first-ever boot.
    }
  }

  // Nothing here yet -- this may be an install that predates the move to localStorage. Adopt the
  // legacy snapshot and rewrite it forward so every later boot is a synchronous read.
  try {
    const legacy = await get(keyFor(accountId, null));
    if (!legacy || legacy.version !== SCHEMA_VERSION) return null;

    const adopted = {
      activePersonId: legacy.activePersonId ?? null,
      byPerson: legacy.byPerson ?? {},
    };
    // Only drop the old copy once the new one is definitely written, so a failing localStorage
    // (private mode, quota) degrades to "still reads from IndexedDB" rather than losing the state.
    if (saveAppState(accountId, userId, adopted)) await del(keyFor(accountId, null));
    return adopted;
  } catch {
    // Losing this error is safe: the legacy read is a one-time best-effort upgrade path, and its
    // only failure modes (no IndexedDB, an evicted or unreadable store) all mean the same thing --
    // there is no older state to adopt. The person starts from defaults, exactly as a new install
    // does, rather than boot failing over a store that is on its way out anyway.
    return null;
  }
}
