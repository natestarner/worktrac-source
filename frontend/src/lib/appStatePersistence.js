import { get, set } from 'idb-keyval';

// Bump when the persisted per-person UI-state shape changes incompatibly -- a mismatched version is
// discarded rather than hydrated, so an old shape can never crash a new build.
const SCHEMA_VERSION = 1;

const idbAvailable = typeof indexedDB !== 'undefined';

// Namespaced by accountId so a second household logging in on the same device never restores the
// first household's in-progress UI state.
function keyFor(accountId) {
  return `worktrac-appstate-${accountId}`;
}

export async function loadAppState(accountId) {
  if (!idbAvailable || accountId == null) return null;
  try {
    const raw = await get(keyFor(accountId));
    if (!raw || raw.version !== SCHEMA_VERSION) return null;
    return { activePersonId: raw.activePersonId ?? null, byPerson: raw.byPerson ?? {} };
  } catch {
    return null;
  }
}

export async function saveAppState(accountId, { activePersonId, byPerson }) {
  if (!idbAvailable || accountId == null) return;
  try {
    await set(keyFor(accountId), { version: SCHEMA_VERSION, activePersonId, byPerson });
  } catch {
    // Best-effort: persistence is a progressive enhancement, never a hard dependency.
  }
}
