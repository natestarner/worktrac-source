import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSetIdMap,
  isTempSetId,
  resolveSetId,
  setSetIdMapping,
} from './setIdMap';

describe('setIdMap', () => {
  beforeEach(async () => {
    await clearSetIdMap();
  });
  afterEach(async () => {
    await clearSetIdMap();
  });

  it('recognizes the optimistic tempId format ExerciseDetail.jsx mints for a logged set', () => {
    expect(isTempSetId('optimistic-abc123')).toBe(true);
    expect(isTempSetId(42)).toBe(false);
    expect(isTempSetId('42')).toBe(false);
  });

  it('resolves a temp id to its real id once mapped, and passes real ids through unchanged', () => {
    const temp = 'optimistic-set-a';
    expect(resolveSetId(temp)).toBe(temp); // not mapped yet -> unchanged
    setSetIdMapping(temp, 987);
    expect(resolveSetId(temp)).toBe(987);
    expect(resolveSetId(123)).toBe(123);
  });

  it('persists the mapping so a fresh boot (empty in-memory map) can still resolve it from IndexedDB', async () => {
    const temp = 'optimistic-persist-me';
    setSetIdMapping(temp, 555);
    await new Promise((r) => setTimeout(r, 20)); // let the async idb write settle

    // A fresh module instance models an app reload: its in-memory map starts empty.
    vi.resetModules();
    const reloaded = await import('./setIdMap');
    expect(reloaded.resolveSetId(temp)).toBe(temp); // not loaded yet
    await reloaded.loadSetIdMap();
    expect(reloaded.resolveSetId(temp)).toBe(555); // restored from disk
  });
});
