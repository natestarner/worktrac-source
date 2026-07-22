import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearExerciseIdMap,
  isTempExerciseId,
  newTempExerciseId,
  resolveExerciseId,
  setExerciseIdMapping,
} from './exerciseIdMap';

describe('exerciseIdMap', () => {
  beforeEach(async () => {
    await clearExerciseIdMap();
  });
  afterEach(async () => {
    await clearExerciseIdMap();
  });

  it('mints recognizable temp ids', () => {
    const id = newTempExerciseId();
    expect(isTempExerciseId(id)).toBe(true);
    expect(isTempExerciseId(42)).toBe(false);
    expect(isTempExerciseId('42')).toBe(false);
  });

  it('resolves a temp id to its real id once mapped, and passes real ids through unchanged', () => {
    const temp = newTempExerciseId();
    expect(resolveExerciseId(temp)).toBe(temp); // not mapped yet -> unchanged
    setExerciseIdMapping(temp, 987);
    expect(resolveExerciseId(temp)).toBe(987);
    expect(resolveExerciseId(123)).toBe(123);
  });

  it('persists the mapping so a fresh boot (empty in-memory map) can still resolve it from IndexedDB', async () => {
    const temp = 'temp-exercise-persist-me';
    setExerciseIdMapping(temp, 555);
    await new Promise((r) => setTimeout(r, 20)); // let the async idb write settle

    // A fresh module instance models an app reload: its in-memory map starts empty.
    vi.resetModules();
    const reloaded = await import('./exerciseIdMap');
    expect(reloaded.resolveExerciseId(temp)).toBe(temp); // not loaded yet
    await reloaded.loadExerciseIdMap();
    expect(reloaded.resolveExerciseId(temp)).toBe(555); // restored from disk
  });
});
