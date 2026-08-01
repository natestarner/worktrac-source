import { get, set, del } from 'idb-keyval';
import { MutationObserver, dehydrate, hydrate } from '@tanstack/react-query';
import { getAuthToken } from '../api/client';
import { byEnqueueOrder, seedOutboxSeq } from './outboxSequence';

// The durable write outbox: every not-yet-synced (outbox-scoped) mutation, persisted to its OWN
// IndexedDB key -- deliberately separate from the query cache's persister.
//
// Why separate (hardening #1): the query cache is discarded on restore if it's older than its
// `maxAge` (1 day) or if `QUERY_CACHE_BUSTER` changes (which it does on an app update). Unsynced
// WRITES must survive both -- a >24h offline gap, or shipping a new build while a user holds queued
// writes -- so they cannot live in that same age-limited, buster-gated blob. This store has no age
// limit and no buster: a queued write persists until it actually syncs.
//
// Durability is NOT tied to TanStack's "paused" mutation state (a prior version of this file was).
// A write that's actively retrying against a failing-but-reachable server, or one that has
// terminal-errored (a run of transient failures, or a 4xx like an expired session), is just as
// unsynced as a paused one and must survive a kill/reload exactly the same way -- see
// `shouldDehydrateMutation` below. Every durable write is idempotent by design (see
// registerOfflineMutationDefaults in queryClient.js), which is what makes it safe to persist and
// later re-dispatch a write that may have already partially reached the server.
export const OUTBOX_SCOPE_ID = 'offline-outbox';

const OUTBOX_KEY_PREFIX = 'worktrac-outbox:';
// Pre-per-account single global key, from before outbox entries were scoped per account. Adopted
// (once) into whichever account's key is read first after an upgrade, so nobody mid-offline during
// the upgrade loses queued writes -- see the migration in `readOutboxKey` below.
const LEGACY_OUTBOX_KEY = 'worktrac-outbox';
// Which account's queued writes currently live in the in-memory mutation cache, so persist/restore
// know which per-account IndexedDB key to use without threading an accountId through every mutation
// dispatch site. Kept in localStorage (synchronous, so it's already known at boot before any React
// context mounts) and kept current by AuthContext at every real login/boot/token-refresh -- see
// `adoptOutboxAccount` there. Deliberately NOT cleared on a 401 (the queued writes still belong to
// whoever's session just expired, and must survive until they log back in); only an explicit
// logout's full discard touches it (see clearOutbox).
const OUTBOX_ACCOUNT_KEY = 'worktrac-outbox-account';

const idbAvailable = typeof indexedDB !== 'undefined';

export function setOutboxAccountId(accountId) {
  try {
    if (accountId == null) localStorage.removeItem(OUTBOX_ACCOUNT_KEY);
    else localStorage.setItem(OUTBOX_ACCOUNT_KEY, String(accountId));
  } catch {
    // Private-mode / quota / disabled storage: falls back to the 'unknown' bucket below.
  }
}

export function getOutboxAccountId() {
  try {
    return localStorage.getItem(OUTBOX_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

// Every function below takes an optional explicit accountId (used by tests, so they don't need to
// touch localStorage) and otherwise falls back to the live pointer above -- which is what every
// production call site relies on, since it's the only way to reach "whichever account is current"
// from outside the React tree (App.jsx's boot effect runs above AuthProvider).
function outboxKeyFor(accountId) {
  const id = accountId ?? getOutboxAccountId();
  return `${OUTBOX_KEY_PREFIX}${id ?? 'unknown'}`;
}

function dehydrateOutbox(queryClient) {
  return dehydrate(queryClient, {
    shouldDehydrateQuery: () => false,
    // Persist every outbox-scoped write that hasn't yet succeeded -- paused (offline), pending
    // (actively retrying against a flaky server), or error (exhausted retries / a definitive 4xx
    // like a stale session) all count. Only a mutation that has actually synced is safe to drop.
    shouldDehydrateMutation: (mutation) =>
      mutation.options.scope?.id === OUTBOX_SCOPE_ID && mutation.state.status !== 'success',
  });
}

// Write the current queued writes to disk immediately. Called eagerly on every mutation-cache
// change AND on pagehide/visibilitychange (hardening #6) -- no throttle, so a set logged and the app
// swipe-killed a fraction of a second later is already durable.
export function persistOutboxNow(queryClient, accountId) {
  if (!idbAvailable) return;
  const dehydrated = dehydrateOutbox(queryClient);
  const key = outboxKeyFor(accountId);
  if (dehydrated.mutations.length > 0) {
    set(key, dehydrated).catch(() => {});
  } else {
    // Nothing queued -> clear the key so a stale outbox can't be replayed later.
    del(key).catch(() => {});
  }
}

// Subscribe the outbox to the mutation cache and to app-exit events. Returns a cleanup function.
// Deliberately does NOT capture accountId once at attach time (that would go stale the moment a
// different account logs in without a reload) -- persistOutboxNow re-reads the live pointer on
// every single event instead, unless a fixed accountId override is passed (tests only).
export function attachOutboxPersistence(queryClient, accountId) {
  if (!idbAvailable) return () => {};
  const unsubscribe = queryClient.getMutationCache().subscribe(() => persistOutboxNow(queryClient, accountId));
  const flush = () => persistOutboxNow(queryClient, accountId);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', flush);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', flush);
  };
}

async function readOutboxKey(key) {
  const dehydrated = await get(key);
  if (dehydrated?.mutations?.length) return dehydrated;
  // One-time migration: adopt the pre-per-account global key if this account's own key is empty,
  // so upgrading mid-offline can't drop anything already queued.
  const legacy = await get(LEGACY_OUTBOX_KEY);
  if (legacy?.mutations?.length) {
    await set(key, legacy).catch(() => {});
    await del(LEGACY_OUTBOX_KEY).catch(() => {});
    return legacy;
  }
  return null;
}

// Rehydrate queued writes into the mutation cache on app boot (or after login re-adopts an
// account -- see AuthContext's adoptOutboxAccount).
//
// CRITICAL: every write shares one TanStack mutation scope (OUTBOX_SCOPE_ID) so they replay one
// at a time -- but the order that guarantee actually enforces is REGISTRATION order into that
// scope (i.e. call order of hydrate()/`.mutate()`), not any timestamp. Restoring paused and
// not-paused writes as two separate batches (hydrate everything paused, THEN dispatch everything
// not-paused) used to register a later-enqueued-but-currently-paused write ahead of an
// earlier-enqueued-but-still-retrying one (lie-fi: a write stays not-paused since
// navigator.onLine is true) -- e.g. an exercise-create actively retrying under lie-fi would lose
// its scope slot to a log-set against it that happened to be paused at persist time, permanently
// wedging the log-set behind an exercise id that can never resolve, and since a retrying
// mutation's status never leaves 'pending', it never releases the scope for anything else either.
// One merged pass, sorted by `byEnqueueOrder` (outboxSequence.js's immutable, app-assigned
// `enqueueSeq`, stamped once into `variables` at first dispatch and never touched again), keeps
// registration order equal to true enqueue order regardless of which cohort each entry falls
// into, and -- unlike TanStack's own `submittedAt` -- stays correct across any number of reloads,
// since re-dispatching a write here never re-stamps its `enqueueSeq` (it's just data in
// `variables`, not framework mutation state).
//
// Per entry:
//  - PAUSED writes are restored via TanStack's own `hydrate`, then the caller resumes them with
//    `resumePausedMutations()` (see flushOutbox in queryClient.js) once connectivity is confirmed.
//  - Anything else (pending mid-retry, or terminal error at persist time) has no live retry to
//    resume -- hydrating it as inert history would leave it stuck forever with nothing to ever
//    continue it. Re-dispatch it fresh from its persisted variables instead. Safe because every
//    durable write is idempotent by design (a replay of one that already reached the server is a
//    no-op, not a duplicate). The dispatch is inlined here (mirroring queryClient.js's
//    enqueueOutboxWrite) rather than imported, to avoid a circular import between this file and
//    queryClient.js (which imports OUTBOX_SCOPE_ID from here). `m.state.variables` already
//    carries this write's original `enqueueSeq` (dehydrate/hydrate round-trips `variables`
//    intact), so this re-dispatch doesn't need to stamp one -- only a genuinely NEW write (via
//    dispatchDurableWrite/useDurableMutation) does that.
//
// Also seeds the app-wide enqueueSeq counter (seedOutboxSeq) to one past the highest seq found in
// this restored batch, before dispatching anything -- so a brand-new write made right after
// restore (the user taps "Log set" while a reload is still settling) can never be assigned a seq
// that collides with or sorts before an already-queued one.
//
// Both of the above assume there's a session to replay against. Boot runs BEFORE AuthContext has
// verified anything (this function is called from App.jsx's persist-provider onSuccess, a sibling
// of AuthProvider, not a descendant), so the only signal available this early is whether a token
// currently sits in storage (getAuthToken() -- see api/client.js). With none (freshly signed out,
// or a token an earlier 401 already cleared), NOTHING here may fire a network request: doing so
// would 401 with no Authorization header, and that 401 can itself tear down a session that a
// moment later *does* have a valid token (a write queued from a completely unrelated earlier
// failure landing right after a fresh login). So with no token, everything -- paused AND
// not-paused alike -- is hydrated as PAUSED instead of dispatched, still sorted by
// `byEnqueueOrder` so a later resume replays in true order too. That's a safe, well-tested state
// to sit in: flushOutbox()'s own resumePausedMutations() (also gated on a token, see
// queryClient.js) resumes it the moment a real session exists again, whether that's this same
// boot (a token was already present) or a later login.
export async function restoreOutbox(queryClient, accountId) {
  if (!idbAvailable) return;
  try {
    const key = outboxKeyFor(accountId);
    const dehydrated = await readOutboxKey(key);
    if (!dehydrated?.mutations?.length) return;

    const maxSeq = dehydrated.mutations.reduce((max, m) => Math.max(max, m.state.variables?.enqueueSeq ?? 0), 0);
    seedOutboxSeq(maxSeq + 1);

    if (!getAuthToken()) {
      const asPaused = dehydrated.mutations
        .slice()
        .sort(byEnqueueOrder)
        .map((m) => ({ ...m, state: { ...m.state, isPaused: true } }));
      hydrate(queryClient, { mutations: asPaused, queries: [] });
      return;
    }

    const ordered = dehydrated.mutations.slice().sort(byEnqueueOrder);

    ordered.forEach((m) => {
      if (m.state.isPaused) {
        hydrate(queryClient, { mutations: [m], queries: [] });
        return;
      }
      const observer = new MutationObserver(queryClient, {
        ...queryClient.getMutationDefaults(m.mutationKey),
        mutationKey: m.mutationKey,
      });
      observer.mutate(m.state.variables).catch(() => {});
    });
  } catch {
    // A corrupt/unreadable outbox must never crash boot; the durable store is best-effort.
  }
}

export function clearOutbox(accountId) {
  if (!idbAvailable) return Promise.resolve();
  return del(outboxKeyFor(accountId)).catch(() => {});
}

// Test-only: undo the account pointer without touching IndexedDB.
export function __resetOutboxAccountForTests() {
  try {
    localStorage.removeItem(OUTBOX_ACCOUNT_KEY);
  } catch {
    // ignore
  }
}
