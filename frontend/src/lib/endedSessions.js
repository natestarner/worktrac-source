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
const CREATES_KEY_PREFIX = 'worktrac-ended-creates:';

// How many ended ids (and pending creates) each person keeps. Only the most recent few can ever be
// fetched back -- a session stops being "live" on the server the moment its end lands -- so this
// just has to outlast a burst of end/start cycles made offline and replayed together.
const MAX_REMEMBERED = 10;
const MAX_REMEMBERED_CREATES = 50;

function keyFor(personId) {
  return `${KEY_PREFIX}${personId}`;
}

// The ended-id list, tolerating the format it replaced. Before 2026-09-23 this key held ONE id as a
// bare string ("22510"), and devices upgrading mid-workout still carry that value -- which must
// keep suppressing its session, or the upgrade itself reopens the 2026-08-08 race.
//
// The ONE place these keys are read, so the one place a read can fail.
function readIds(key) {
  let raw = null;
  try {
    raw = localStorage.getItem(key);
    if (raw == null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    // Unreadable storage (private mode, disabled site data): nothing to suppress, which only reopens
    // the race this closes -- never worth throwing into a render over. A value that is not JSON can
    // only be a legacy bare id, which is kept.
    return raw == null ? [] : [raw];
  }
}

// The ONE place these keys are written.
function remember(key, id, max) {
  try {
    const ids = readIds(key).filter((existing) => existing !== String(id));
    ids.push(String(id));
    localStorage.setItem(key, JSON.stringify(ids.slice(-max)));
  } catch {
    // Private mode / quota. Losing the marker only reopens the race it closes; never throw into a
    // "End workout" tap, or a set landing, over it.
  }
}

export function markSessionEnded(personId, sessionId) {
  // A session with no real id yet (the offline placeholder) was never on the server, so there is
  // no id to suppress -- see markCreatesEnded below for how that session is caught once it has one.
  if (!personId || !sessionId) return;
  remember(keyFor(personId), sessionId, MAX_REMEMBERED);
}

// Deliberately never cleared, only trimmed to the most recent few. Each id suppresses exactly one
// session, and a session id is never reused (ending is terminal), so a stale entry can only ever
// match the session it was written for -- a genuinely new session has a different id and passes
// through untouched.
//
// SEVERAL ids, not one (2026-09-23). Two workouts ended offline replay as create, end, create,
// end; with a single slot, marking the second unmarks the first, and a live-session read that left
// before the first end landed can still bring it back.
export function isSessionEnded(personId, sessionId) {
  if (!personId || !sessionId) return false;
  return readIds(keyFor(personId)).includes(String(sessionId));
}

// Ending a workout whose sets have not synced yet: the live session is still the `{ id: null }`
// placeholder, so markSessionEnded has no id to record. The session those sets will create is
// identified instead by the sets themselves -- the tempIds of the creates still pending at the End
// tap, which are exactly the ended workout's sets. When one lands, the session in its response is
// marked ended (queryClient.js's LOG_SET onSettled) before anything can treat it as live.
//
// Without this, the create's response wrote the session back as LIVE with the end still queued
// behind it, and the next workout's sets were shown as part of the ended one ("Set 2" on a first
// set) -- for the whole outage when degraded. docs/incidents/2026-09-23-end-workout-mid-save-resurrected.md
//
// tempIds rather than the time of the tap: a set's clientLoggedAt is the device clock, and a clock
// correction between the End tap and the next set would misfile a new workout as the ended one.
// localStorage, synchronous, for the same reload-proofing as the ended ids above.
export function markCreatesEnded(personId, tempIds) {
  if (!personId || !tempIds?.length) return;
  tempIds.forEach((tempId) => remember(`${CREATES_KEY_PREFIX}${personId}`, tempId, MAX_REMEMBERED_CREATES));
}

export function isCreateInEndedWorkout(personId, tempId) {
  if (!personId || !tempId) return false;
  return readIds(`${CREATES_KEY_PREFIX}${personId}`).includes(String(tempId));
}
