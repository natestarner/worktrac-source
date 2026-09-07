import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { loadAppState, saveAppState, LEGACY_IDB_KEY_PREFIX } from './appStatePersistence';

const ACCOUNT = 42;
// A login id: the key is scoped by (account, login) now, not by account alone.
const USER = 'user-1';
const SNAPSHOT = {
  activePersonId: 7,
  byPerson: { 7: { activeRoutineId: 3, routineIndex: 1, lastTab: '/app/log' } },
};

describe('appStatePersistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The bug this module was changed to fix: a routine-position change is followed immediately by a
  // reload (a tap, or swUpdate's silent forced reload after a deploy), and the write has to already
  // be durable at that instant. An async store cannot promise that -- there is no way to flush an
  // in-flight IndexedDB transaction during document teardown. So the contract is synchronous
  // durability, and that is what this asserts: the value is readable with NO awaits in between.
  it('is durable the instant saveAppState returns, with nothing awaited', () => {
    saveAppState(ACCOUNT, USER, SNAPSHOT);

    // Deliberately not awaiting anything -- not even a microtask. This is the whole guarantee.
    const raw = localStorage.getItem(`worktrac-appstate-${ACCOUNT}:${USER}`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).byPerson[7].routineIndex).toBe(1);
  });

  it('round-trips through loadAppState', async () => {
    saveAppState(ACCOUNT, USER, SNAPSHOT);
    await expect(loadAppState(ACCOUNT, USER)).resolves.toEqual(SNAPSHOT);
  });

  it('keeps each account separate', async () => {
    saveAppState(ACCOUNT, USER, SNAPSHOT);
    await expect(loadAppState(99, USER)).resolves.toBeNull();
  });

  it('discards a snapshot written under an incompatible schema version', async () => {
    localStorage.setItem(
      `worktrac-appstate-${ACCOUNT}`,
      JSON.stringify({ version: 999, activePersonId: 1, byPerson: { 1: {} } }),
    );
    await expect(loadAppState(ACCOUNT, USER)).resolves.toBeNull();
  });

  it('ignores malformed JSON rather than throwing into boot', async () => {
    localStorage.setItem(`worktrac-appstate-${ACCOUNT}`, '{not json');
    await expect(loadAppState(ACCOUNT, USER)).resolves.toBeNull();
  });

  // Existing installs have their state in IndexedDB under the old key. Without this, everyone
  // upgrading would silently lose an in-progress routine exactly once -- the "persisted slice
  // predating a change" axis of the resilience contract.
  describe('migration from the legacy IndexedDB store', () => {
    it('adopts a legacy snapshot when localStorage has none, and rewrites it forward', async () => {
      await set(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`, { version: 1, ...SNAPSHOT });

      await expect(loadAppState(ACCOUNT, USER)).resolves.toEqual(SNAPSHOT);

      // Migrated forward, so the next boot is a synchronous read and the legacy copy is gone.
      expect(localStorage.getItem(`worktrac-appstate-${ACCOUNT}:${USER}`)).toBeTruthy();
      await expect(get(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`)).resolves.toBeUndefined();
    });

    it('prefers localStorage over a stale legacy copy', async () => {
      await set(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`, {
        version: 1,
        activePersonId: 7,
        byPerson: { 7: { routineIndex: 0 } },
      });
      saveAppState(ACCOUNT, USER, SNAPSHOT);

      const loaded = await loadAppState(ACCOUNT, USER);
      expect(loaded.byPerson[7].routineIndex).toBe(1);
    });

    it('discards a legacy snapshot under an incompatible schema version', async () => {
      await set(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`, { version: 999, ...SNAPSHOT });
      await expect(loadAppState(ACCOUNT, USER)).resolves.toBeNull();
    });
  });

  it('degrades quietly when storage throws (private mode, quota, disabled)', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      expect(() => saveAppState(ACCOUNT, USER, SNAPSHOT)).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
    await expect(loadAppState(ACCOUNT, USER)).resolves.toBeNull();
  });

  it('no-ops without an accountId rather than writing a shared key', async () => {
    expect(() => saveAppState(null, USER, SNAPSHOT)).not.toThrow();
    expect(localStorage.getItem('worktrac-appstate-null')).toBeNull();
    await expect(loadAppState(null, USER)).resolves.toBeNull();
  });

  // ⚠️ THE MEMBER-LOGIN CASE. Two logins in the SAME household, on one device.
  //
  // activePersonId and every byPerson draft live in this store, so under an account-only key a
  // member signing in after a sibling would open on the SIBLING's person -- one they may not even
  // be allowed to write to -- with the sibling's half-typed weight and reps still in the fields.
  describe('two members of one household', () => {
    it('never restore each other\'s in-progress state', async () => {
      saveAppState(ACCOUNT, 'member-a', SNAPSHOT);

      await expect(loadAppState(ACCOUNT, 'member-b')).resolves.toBeNull();
      // And A's own state is untouched.
      await expect(loadAppState(ACCOUNT, 'member-a')).resolves.toEqual(SNAPSHOT);
    });

    // The tombstone. The per-account key is shared by the whole household, so an unbounded
    // fallback would hand it to whichever member signed in next -- reintroducing the leak above
    // through the migration meant to carry state ACROSS the re-key.
    //
    // Sound because at migration time the only login that account has ever had on this device is
    // the one that wrote that state: member logins did not exist when it was written.
    it('adopt the per-account key exactly once, and never for the second member', async () => {
      // State written before logins were scoped per user, under the bare per-account key.
      localStorage.setItem(
        `worktrac-appstate-${ACCOUNT}`,
        JSON.stringify({ version: 1, ...SNAPSHOT }),
      );

      // The owner signs in first and inherits their own pre-upgrade state.
      await expect(loadAppState(ACCOUNT, 'owner')).resolves.toEqual(SNAPSHOT);
      expect(localStorage.getItem(`worktrac-appstate-${ACCOUNT}`)).toBeNull();
      expect(localStorage.getItem(`worktrac-appstate-${ACCOUNT}:owner`)).toBeTruthy();

      // A member signing in afterwards gets nothing.
      await expect(loadAppState(ACCOUNT, 'member')).resolves.toBeNull();
    });

    // Even if the per-account key somehow survives (a failed write during adoption), the tombstone
    // alone must keep a second member out of it.
    it('the tombstone alone keeps a second member out, even if the old key survives', async () => {
      localStorage.setItem(
        `worktrac-appstate-${ACCOUNT}`,
        JSON.stringify({ version: 1, ...SNAPSHOT }),
      );
      await loadAppState(ACCOUNT, 'owner');

      // Put the shared key back, as a failed delete would have left it.
      localStorage.setItem(
        `worktrac-appstate-${ACCOUNT}`,
        JSON.stringify({ version: 1, ...SNAPSHOT }),
      );

      await expect(loadAppState(ACCOUNT, 'member')).resolves.toBeNull();
    });
  });

});
