import { apiClient } from './client';
import { historyEtagFor, recordHistoryEtag } from '../lib/historyEtags';

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

// A person's whole history, sent with the ETag of the copy already cached (if that copy came from a
// tagged response -- see lib/historyEtags.js), so an unchanged history costs a 304 instead of
// megabytes. HistoryEtagConfig.java is the server half; its tag is a hash of the response bytes, so
// a 304 means "byte-for-byte what produced this copy".
//
// `readCached` returns what the history query currently holds. A 304 is acted on only if the cache
// STILL holds the very object whose tag was sent -- if anything replaced it while the request was
// out, the answer is about a copy that is no longer there, so this asks again without a tag rather
// than resurrect it. Callers that pass no `readCached` get an ordinary full fetch.
//
// Not a connectivity branch: a conditional request fails exactly like an unconditional one, through
// api/client.js, in every mode.
export async function getHistory(personId, { readCached } = {}) {
  const cached = readCached?.();
  const etag = historyEtagFor(cached);
  const result = await apiClient.getConditional(`/api/people/${personId}/history`, etag);
  if (result.notModified) {
    if (readCached() === cached) return cached;
    return getHistory(personId);
  }
  recordHistoryEtag(result.data, result.etag);
  return result.data;
}

// How much of this person's history the Free-tier window is hiding right now:
// `{ windowStart, hiddenSessions, earliestHiddenAt }`. The SERVER answers this -- the client knows
// the plan but deliberately not the window, so there is never a second copy of the 90 days to drift
// from the clamp it describes. See HistoryWindowNotice.jsx.
export function getHistoryWindow(personId) {
  return apiClient.get(`/api/people/${personId}/history-window`);
}
