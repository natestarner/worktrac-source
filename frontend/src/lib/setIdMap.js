import { get, set, del } from 'idb-keyval';

// Maps a locally-minted optimistic set id (the tempId a logSet mutation carries before it syncs --
// see ExerciseDetail.jsx's handleLogSet, `optimistic-${newId()}`) to the real server set id once its
// create syncs. This is what lets "edit a set you just logged offline" become a genuinely separate,
// later write (a durable EDIT_SET targeting the temp id) instead of mutating the queued create --
// see offlineSetEdits.js and queryClient.js's EDIT_SET mutationFn for why: TanStack has no public way
// to update or cancel an in-flight mutation, and mutating the create in place would also let the
// backend's idempotency dedup (WorkoutSetService.findDuplicate) silently discard the edit if the
// original create had already reached the server. Mirrors exerciseIdMap.js's temp-exercise-id
// resolution exactly -- same shape, same reasoning, applied to a second entity.
//
// Persisted to its own IndexedDB key (not the query cache) so it survives an app close: if the
// create synced but a queued edit against it didn't before a reload, the mapping is still on disk to
// resolve it. In-memory mirror kept in sync for a synchronous lookup from the edit-set mutationFn.
const IDMAP_KEY = 'worktrac-set-idmap';
const TEMP_PREFIX = 'optimistic-';

const idbAvailable = typeof indexedDB !== 'undefined';
let memory = new Map();

export function isTempSetId(id) {
  return typeof id === 'string' && id.startsWith(TEMP_PREFIX);
}

// Resolve a set id for a network call: a temp id becomes its real id once known; anything else (a
// real numeric id, or a temp id not yet mapped) is returned unchanged.
export function resolveSetId(id) {
  if (isTempSetId(id) && memory.has(id)) return memory.get(id);
  return id;
}

export function setSetIdMapping(tempId, realId) {
  memory.set(tempId, realId);
  if (idbAvailable) set(IDMAP_KEY, Object.fromEntries(memory)).catch(() => {});
}

// Load the persisted map into memory on boot, so an edit queued before an app close can still resolve.
export async function loadSetIdMap() {
  if (!idbAvailable) return;
  try {
    const stored = await get(IDMAP_KEY);
    if (stored) memory = new Map(Object.entries(stored));
  } catch {
    // best-effort
  }
}

export function clearSetIdMap() {
  memory = new Map();
  if (idbAvailable) return del(IDMAP_KEY).catch(() => {});
  return Promise.resolve();
}

// Test-only peek.
export function _getMappingForTest(tempId) {
  return memory.get(tempId);
}
