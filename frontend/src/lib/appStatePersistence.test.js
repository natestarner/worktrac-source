import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { loadAppState, saveAppState, LEGACY_IDB_KEY_PREFIX } from './appStatePersistence';

const ACCOUNT = 42;
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
    saveAppState(ACCOUNT, SNAPSHOT);

    // Deliberately not awaiting anything -- not even a microtask. This is the whole guarantee.
    const raw = localStorage.getItem(`worktrac-appstate-${ACCOUNT}`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).byPerson[7].routineIndex).toBe(1);
  });

  it('round-trips through loadAppState', async () => {
    saveAppState(ACCOUNT, SNAPSHOT);
    await expect(loadAppState(ACCOUNT)).resolves.toEqual(SNAPSHOT);
  });

  it('keeps each account separate', async () => {
    saveAppState(ACCOUNT, SNAPSHOT);
    await expect(loadAppState(99)).resolves.toBeNull();
  });

  it('discards a snapshot written under an incompatible schema version', async () => {
    localStorage.setItem(
      `worktrac-appstate-${ACCOUNT}`,
      JSON.stringify({ version: 999, activePersonId: 1, byPerson: { 1: {} } }),
    );
    await expect(loadAppState(ACCOUNT)).resolves.toBeNull();
  });

  it('ignores malformed JSON rather than throwing into boot', async () => {
    localStorage.setItem(`worktrac-appstate-${ACCOUNT}`, '{not json');
    await expect(loadAppState(ACCOUNT)).resolves.toBeNull();
  });

  // Existing installs have their state in IndexedDB under the old key. Without this, everyone
  // upgrading would silently lose an in-progress routine exactly once -- the "persisted slice
  // predating a change" axis of the resilience contract.
  describe('migration from the legacy IndexedDB store', () => {
    it('adopts a legacy snapshot when localStorage has none, and rewrites it forward', async () => {
      await set(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`, { version: 1, ...SNAPSHOT });

      await expect(loadAppState(ACCOUNT)).resolves.toEqual(SNAPSHOT);

      // Migrated forward, so the next boot is a synchronous read and the legacy copy is gone.
      expect(localStorage.getItem(`worktrac-appstate-${ACCOUNT}`)).toBeTruthy();
      await expect(get(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`)).resolves.toBeUndefined();
    });

    it('prefers localStorage over a stale legacy copy', async () => {
      await set(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`, {
        version: 1,
        activePersonId: 7,
        byPerson: { 7: { routineIndex: 0 } },
      });
      saveAppState(ACCOUNT, SNAPSHOT);

      const loaded = await loadAppState(ACCOUNT);
      expect(loaded.byPerson[7].routineIndex).toBe(1);
    });

    it('discards a legacy snapshot under an incompatible schema version', async () => {
      await set(`${LEGACY_IDB_KEY_PREFIX}${ACCOUNT}`, { version: 999, ...SNAPSHOT });
      await expect(loadAppState(ACCOUNT)).resolves.toBeNull();
    });
  });

  it('degrades quietly when storage throws (private mode, quota, disabled)', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    try {
      expect(() => saveAppState(ACCOUNT, SNAPSHOT)).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
    await expect(loadAppState(ACCOUNT)).resolves.toBeNull();
  });

  it('no-ops without an accountId rather than writing a shared key', async () => {
    expect(() => saveAppState(null, SNAPSHOT)).not.toThrow();
    expect(localStorage.getItem('worktrac-appstate-null')).toBeNull();
    await expect(loadAppState(null)).resolves.toBeNull();
  });
});
