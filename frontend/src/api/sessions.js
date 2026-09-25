import { apiClient } from './client';
import { applyHistorySync, findDrift, fingerprintsOf, heldForSync, isSyncedHistory } from '../lib/historySync';

export function getLiveSession(personId) {
  return apiClient.get(`/api/people/${personId}/sessions/live`);
}

export function endWorkout(personId) {
  return apiClient.post(`/api/people/${personId}/sessions/live/end`);
}

export function createPastSession(personId, startedAt) {
  return apiClient.post(`/api/people/${personId}/sessions`, { startedAt });
}

export function editSession(sessionId, startedAt) {
  return apiClient.patch(`/api/sessions/${sessionId}`, { startedAt });
}

// A person's history, synced a month at a time (lib/historySync.js): the months already cached are
// sent with their fingerprints, and only the ones that changed come back. After a reload, a warm, or
// a write to another month, that is usually nothing at all.
//
// `readCached` returns what the history query currently holds -- the months to send. Every caller
// passes it (useHistory, offlineCacheWarm, the ended-workout prefetch, AppSettingsTab); one that
// didn't would still be correct, just always a full download.
//
// Resolves to the synced shape, never the flat list: read it through flattenHistory.
//
// Not a connectivity branch: the sync fails exactly like any other read, through api/client.js, in
// every mode, and a failed sync leaves the cached months in place.
export async function getHistory(personId, { readCached } = {}) {
  const cached = readCached?.();
  const held = heldForSync(cached);
  const reply = await apiClient.post(`/api/people/${personId}/history/sync`, { have: fingerprintsOf(held) });
  // A synced cache that is not offered is the daily full sync -- the canary's one chance to look.
  if (!held && isSyncedHistory(cached)) {
    const drifted = findDrift(cached, reply);
    if (drifted.length > 0) reportHistoryDrift(personId, drifted);
  }
  return applyHistorySync(held, reply);
}

// Best-effort and never awaited: a diagnostic, not a person's write, so it has no outbox behind it
// and a failure to send it must never fail -- or delay -- the sync that found it.
function reportHistoryDrift(personId, months) {
  apiClient.post(`/api/people/${personId}/history/drift`, { months }).catch(() => {});
}

// How much of this person's history the Free-tier window is hiding right now:
// `{ windowStart, hiddenSessions, earliestHiddenAt }`. The SERVER answers this -- the client knows
// the plan but deliberately not the window, so there is never a second copy of the 90 days to drift
// from the clamp it describes. See HistoryWindowNotice.jsx.
export function getHistoryWindow(personId) {
  return apiClient.get(`/api/people/${personId}/history-window`);
}
