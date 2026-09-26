// History is held a month at a time, each month with the fingerprint the server sent it with, and
// refreshed through POST /history/sync: the client says which months it holds, the server sends
// only the months whose fingerprint no longer matches. WorkoutSessionService#syncHistory is the
// server half, and its header explains why a matching fingerprint means "exactly what you hold".
//
// The cached value of queryKeys.history(personId):
//   { format: 2, months: { 'yyyy-mm': { fp, sessions } }, fullSyncedAt }
// Nothing outside this module and api/sessions.js#getHistory reads that shape: every screen gets
// the flat, newest-first session array through flattenHistory, exactly as before.
//
// Its own module rather than inside api/sessions.js because a dozen test files mock that module
// wholesale, and useHistory needs flattenHistory to be real.

export const HISTORY_FORMAT = 2;

// The backstop. Once a day the client asks for everything, as if it held nothing. A fingerprint the
// server computes wrongly, or a merge bug here, would otherwise leave a month on the device that no
// longer matches the server with nothing to ever correct it; this bounds any such bug to a day.
// For a household it costs one full download per person per device per day.
export const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function isSyncedHistory(value) {
  return value != null && value.format === HISTORY_FORMAT && value.months != null && typeof value.months === 'object';
}

// The months to send as `have`: what the cached value holds, unless there is nothing usable
// (nothing cached, a plain array persisted by a build that predates the sync) or the daily full
// sync is due -- then nothing, which asks for everything.
//
// A stamp in the future counts as due too: a device clock that was wrong when it was written and has
// since been corrected must not postpone the backstop until the wrong date comes round.
export function heldForSync(cached, now = Date.now()) {
  if (!isSyncedHistory(cached)) return null;
  const age = now - cached.fullSyncedAt;
  if (!(age >= 0 && age < FULL_SYNC_INTERVAL_MS)) return null;
  return cached;
}

export function fingerprintsOf(held) {
  const have = {};
  if (held) for (const [month, { fp }] of Object.entries(held.months)) have[month] = fp;
  return have;
}

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
export function applyHistorySync(held, reply, now = Date.now()) {
  const scoped = Array.isArray(reply.scope);
  if (scoped && !held) {
    throw new Error('History sync answered a scoped reply to a device holding nothing');
  }
  const months = {};
  if (scoped) {
    const inScope = new Set(reply.scope);
    for (const [month, content] of Object.entries(held.months)) {
      if (!inScope.has(month)) months[month] = content;
    }
  }
  for (const month of reply.months) {
    const sent = reply.changed?.[month];
    if (sent) {
      months[month] = sent;
    } else if (held?.months?.[month]) {
      months[month] = held.months[month];
    } else {
      throw new Error(`History sync listed ${month} without sending it`);
    }
  }
  return { format: HISTORY_FORMAT, months, fullSyncedAt: held ? held.fullSyncedAt : now };
}

// The production canary, run on the daily full sync -- the one moment the device re-reads months it
// would otherwise have trusted. A month whose fingerprint is the SAME as the one held but whose
// content differs means the fingerprint missed a change: the exact failure the month sync must never
// have, and one the regular syncs could never notice (they would call the month unchanged). The full
// sync has already fixed the device; this only makes it visible (api/sessions.js reports it, and the
// server logs it -- docs/architecture/history-sync.md). Month ids only, never content.
export function findDrift(cached, reply) {
  if (!isSyncedHistory(cached)) return [];
  const drifted = [];
  for (const [month, sent] of Object.entries(reply.changed ?? {})) {
    const held = cached.months[month];
    if (held && held.fp === sent.fp && JSON.stringify(held.sessions) !== JSON.stringify(sent.sessions)) {
      drifted.push(month);
    }
  }
  return drifted;
}

// Every session, newest first -- the one shape every History reader has always had. A plain array
// is passed through unchanged: it is a cache persisted by a build that predates the sync, still
// perfectly readable (offline, it may be all there is until the first sync replaces it).
export function flattenHistory(data) {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (!isSyncedHistory(data)) return [];
  return Object.keys(data.months)
    .sort()
    .reverse()
    .flatMap((month) => data.months[month].sessions);
}
