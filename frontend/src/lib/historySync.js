// History is held a month at a time, each month with the fingerprint the server sent it with, and
// refreshed through POST /history/sync: the client says which months it holds, the server sends
// only the months whose fingerprint no longer matches. WorkoutSessionService#syncHistory is the
// server half, and its header explains why a matching fingerprint means "exactly what you hold".
//
// The cached value of queryKeys.history(personId):
//   { format: 2, months: { 'yyyy-mm': { fp, sessions } }, checked: { 'yyyy-mm': ms }, fullSyncedAt }
// Nothing outside this module and api/sessions.js#getHistory reads that shape: every screen gets
// the flat, newest-first session array through flattenHistory, exactly as before.
//
// `checked` is when each month's content was last re-read from the server -- sent because it changed,
// or re-sent by the rolling check (auditFor). It lives BESIDE `months`, not inside them, so a sync
// that only moves a check time leaves `months` -- and everything derived from it -- untouched.
// `fullSyncedAt` is when the device last downloaded everything (sign-in, a new device); informational.
//
// Its own module rather than inside api/sessions.js because a dozen test files mock that module
// wholesale, and useHistory needs flattenHistory to be real.

export const HISTORY_FORMAT = 2;

// How many months the rolling check re-reads per ordinary sync. Ordinary syncs run on app open,
// refocus, the periodic warm and History opening stale -- several an hour while the app is in use --
// so one month each re-reads a five-year History (61 months) within hours of use.
export const AUDIT_MONTHS_PER_SYNC = 1;

export function isSyncedHistory(value) {
  return value != null && value.format === HISTORY_FORMAT && value.months != null && typeof value.months === 'object';
}

// The months to send as `have`: what the cached value holds, or nothing -- asking for everything --
// when there is nothing usable (nothing cached, a plain array persisted by a build that predates the
// sync). There is deliberately no periodic full download any more: the rolling check (auditFor) is
// the backstop, one month at a time.
export function heldForSync(cached) {
  return isSyncedHistory(cached) ? cached : null;
}

export function fingerprintsOf(held) {
  const have = {};
  if (held) for (const [month, { fp }] of Object.entries(held.months)) have[month] = fp;
  return have;
}

// THE ROLLING CHECK. The months to ask the server to re-send in full on this ordinary sync, whatever
// their fingerprint says: the ones re-read longest ago (never first; among those, the newest month,
// since recent months are the ones that change). Over successive syncs every held month is re-read.
//
// It is the backstop the daily full download used to be, at the cost of a month instead of the whole
// History: a fingerprint the server computed wrongly, or a merge bug here, leaves a month on the
// device that no longer matches the server, and nothing but re-reading it can ever notice.
export function auditFor(held, count = AUDIT_MONTHS_PER_SYNC) {
  if (!held) return [];
  const checked = held.checked ?? {};
  return Object.keys(held.months)
    .sort((a, b) => (checked[a] ?? -Infinity) - (checked[b] ?? -Infinity) || (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, count);
}

const sameContent = (a, b) => JSON.stringify(a.sessions) === JSON.stringify(b.sessions);

// The server's reply applied to what was held when the request went out. The months afterwards are
// exactly the reply's list: each one either sent, or kept from `held` (the server only omits a month
// whose fingerprint matched what `held` said). A held month the reply does not list is gone.
//
// A listed month that was neither sent nor held can only be a server bug; it throws rather than
// silently dropping the month, so the query keeps what it had and retries.
//
// Kept months are the SAME objects as in `held`, so structural sharing keeps every unchanged month
// -- and its sessions -- by identity.
//
// A SCOPED reply (`reply.scope` is a list -- the sync after a write on this device) speaks only for
// the months in its scope: of those, the listed ones are sent or kept and the rest are gone, while
// every month OUTSIDE the scope stays exactly as held, to be re-verified by the next ordinary sync.
// A reply with no `scope` -- every ordinary sync, and any reply from a server that predates scoped
// syncs -- is the complete list, as always.
//
// `reply.audited` (the rolling check) re-sends months in full: each replaces the held copy -- kept by
// identity when it is the same -- and is stamped as checked now. findAuditDrift reports the one case
// that should never happen: the same fingerprint with different content.
export function applyHistorySync(held, reply, now = Date.now()) {
  const scoped = Array.isArray(reply.scope);
  if (scoped && !held) {
    throw new Error('History sync answered a scoped reply to a device holding nothing');
  }
  const months = {};
  const checked = {};
  const keep = (month) => {
    months[month] = held.months[month];
    if (held.checked?.[month] != null) checked[month] = held.checked[month];
  };
  if (scoped) {
    const inScope = new Set(reply.scope);
    for (const month of Object.keys(held.months)) if (!inScope.has(month)) keep(month);
  }
  for (const month of reply.months) {
    const sent = reply.changed?.[month];
    if (sent) {
      months[month] = sent;
      checked[month] = now;
    } else if (held?.months?.[month]) {
      keep(month);
    } else {
      throw new Error(`History sync listed ${month} without sending it`);
    }
  }
  for (const [month, audited] of Object.entries(reply.audited ?? {})) {
    if (!(month in months)) continue;
    const mine = months[month];
    if (!(mine.fp === audited.fp && sameContent(mine, audited))) months[month] = audited;
    checked[month] = now;
  }
  return { format: HISTORY_FORMAT, months, checked, fullSyncedAt: held ? held.fullSyncedAt : now };
}

// The production canary. The rolling check re-reads months the device would otherwise have trusted;
// one whose fingerprint is the SAME as the one held but whose content differs means the fingerprint
// missed a change -- the exact failure the month sync must never have, and one the regular syncs
// could never notice. applyHistorySync has already replaced it; this only makes it visible
// (api/sessions.js reports it, the server logs it -- docs/architecture/history-sync.md). Month ids
// only, never content.
export function findAuditDrift(held, reply) {
  if (!held) return [];
  const drifted = [];
  for (const [month, audited] of Object.entries(reply.audited ?? {})) {
    const mine = held.months[month];
    if (mine && mine.fp === audited.fp && !sameContent(mine, audited)) drifted.push(month);
  }
  return drifted;
}

// Every session, newest first -- the one shape every History reader has always had. A plain array
// is passed through unchanged: it is a cache persisted by a build that predates the sync, still
// perfectly readable (offline, it may be all there is until the first sync replaces it).
//
// Memoized by the `months` object: a sync that changes nothing but check times leaves `months` the
// same object (structural sharing), and so hands every screen the SAME array -- no screen re-derives
// records from five years of History because a month was re-read and found unchanged.
const flattened = new WeakMap();

export function flattenHistory(data) {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (!isSyncedHistory(data)) return [];
  const cached = flattened.get(data.months);
  if (cached) return cached;
  const flat = Object.keys(data.months)
    .sort()
    .reverse()
    .flatMap((month) => data.months[month].sessions);
  flattened.set(data.months, flat);
  return flat;
}
