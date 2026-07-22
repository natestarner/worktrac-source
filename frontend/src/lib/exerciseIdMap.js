import { get, set, del } from 'idb-keyval';

// Maps a locally-minted temporary exercise id (assigned when you create an exercise offline) to the
// real server id once its create syncs. This is what lets you "create an exercise AND log sets
// against it" fully offline: the queued set-logs reference the TEMP id, and when they replay we
// substitute the real id here.
//
// Persisted to its own IndexedDB key (not the query cache) so it survives an app close: if the
// create synced but its sets didn't before a reload, the mapping is still on disk to resolve them.
// In-memory mirror kept in sync for a synchronous lookup from the log-set mutationFn.
const IDMAP_KEY = 'worktrac-exercise-idmap';
const TEMP_PREFIX = 'temp-exercise-';

const idbAvailable = typeof indexedDB !== 'undefined';
let memory = new Map();

export function newTempExerciseId() {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${TEMP_PREFIX}${rand}`;
}

export function isTempExerciseId(id) {
  return typeof id === 'string' && id.startsWith(TEMP_PREFIX);
}

// Resolve an exercise id for a network call: a temp id becomes its real id once known; anything else
// (a real numeric id, or a temp id not yet mapped) is returned unchanged.
export function resolveExerciseId(id) {
  if (isTempExerciseId(id) && memory.has(id)) return memory.get(id);
  return id;
}

export function setExerciseIdMapping(tempId, realId) {
  memory.set(tempId, realId);
  if (idbAvailable) set(IDMAP_KEY, Object.fromEntries(memory)).catch(() => {});
}

// Load the persisted map into memory on boot, so a set queued before an app close can still resolve.
export async function loadExerciseIdMap() {
  if (!idbAvailable) return;
  try {
    const stored = await get(IDMAP_KEY);
    if (stored) memory = new Map(Object.entries(stored));
  } catch {
    // best-effort
  }
}

export function clearExerciseIdMap() {
  memory = new Map();
  if (idbAvailable) return del(IDMAP_KEY).catch(() => {});
  return Promise.resolve();
}

// Test-only peek.
export function _getMappingForTest(tempId) {
  return memory.get(tempId);
}
