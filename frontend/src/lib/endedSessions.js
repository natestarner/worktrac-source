// Which session each person has most recently ended, recorded SYNCHRONOUSLY in localStorage.
//
// Ending a workout clears the `liveSession` query entry, but that clear only reaches disk on the
// persister's next throttled tick (persistQueryClient defaults to 1s; persistOptions sets no
// throttleTime). swUpdate.js's tryForceUpdate silently reloads on ordinary navigation whenever a
// new service-worker build is available -- and one always is right after a deploy -- so a reload
// landing inside that window boots from a snapshot taken BEFORE the end, and hydrate() brings the
// finished session back.
//
// That is not merely stale: `liveSession.id` feeds ExerciseDetail's `contextSessionId`, which
// gates the `sessionSets` query. A restored ended session has a REAL id -- unlike the deliberate
// `{ id: null }` offline placeholder that contextSessionId is designed to ignore -- so the app
// treats it as live and renders that finished session's still-cached sets under "This session".
// Online the 10s staleTime corrects it on the next refetch; offline nothing can, so it stands for
// the whole offline stretch.
//
// localStorage rather than the query cache or IndexedDB precisely because the write is
// synchronous: there is no window for a reload to beat it. Same reasoning as offlineMode.js's
// manual pin and outboxPersistence.js's account pointer, both of which must also survive a reload
// they can't predict.
const KEY_PREFIX = 'worktrac-ended-session:';

function keyFor(personId) {
  return `${KEY_PREFIX}${personId}`;
}

export function markSessionEnded(personId, sessionId) {
  // A session with no real id yet (the offline placeholder) was never on the server, so there is
  // nothing a reload could restore and nothing to suppress.
  if (!personId || !sessionId) return;
  try {
    localStorage.setItem(keyFor(personId), String(sessionId));
  } catch {
    // Private mode / quota. Losing the marker only reopens the original race; never throw into a
    // "End workout" tap over it.
  }
}

// Deliberately never cleared. It suppresses exactly one id, and a session id is never reused
// (ending is terminal), so a stale marker can only ever match the session it was written for --
// a genuinely new session has a different id and passes through untouched.
export function isSessionEnded(personId, sessionId) {
  if (!personId || !sessionId) return false;
  try {
    return localStorage.getItem(keyFor(personId)) === String(sessionId);
  } catch {
    return false;
  }
}
