import { QueryClient, MutationObserver, onlineManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';
import { queryKeys } from '../api/queryKeys';
import { logLiveSet, logSetIntoSession, editSet, deleteSet } from '../api/sets';
import { addExercise, favoriteExercise, unfavoriteExercise } from '../api/exercises';
import { saveLiveExerciseNote, saveSessionExerciseNote } from '../api/notes';
import { endWorkout, getHistory } from '../api/sessions';
import { getAuthToken } from '../api/client';
import { OUTBOX_SCOPE_ID } from './outboxPersistence';
import { resolveExerciseId, setExerciseIdMapping, isTempExerciseId } from './exerciseIdMap';
import { resolveSetId, setSetIdMapping, isTempSetId } from './setIdMap';
import { isCreateInEndedWorkout, isSessionEnded, markSessionEnded } from './endedSessions';
import { byEnqueueOrder, withEnqueueSeq } from './outboxSequence';
import { flattenHistory } from './historySync';

// Bump when the shape of anything we cache changes incompatibly -- the persister discards a
// restored cache whose buster doesn't match instead of hydrating stale/incompatible data.
export const QUERY_CACHE_BUSTER = 'v1';

// The persisted cache must never expire while the session that could use it is still valid.
//
// It was 24h, and 24h was a cliff pointing the wrong way: the person most likely to NEED the
// offline cache is the one who has not opened the app in a while against a backend that has
// therefore scaled to zero -- exactly the person the old bound had just thrown it away from.
// Measured 2026-09-02 with the cache aged past the bound and the backend cold: the app boots
// (chrome, person pills, tabs) with EVERY section empty for the full 15s abort and beyond, which is
// the "logged in but none of my data is there" half of that day's report.
//
// 30 days, matching the JWT's own lifetime, and that pairing is the whole point rather than a
// coincidence. `timestamp` is re-stamped by persistQueryClient on EVERY persist, so maxAge measures
// "how long since this device last had the app open", not how old the data is. Past 30 days the
// token has expired anyway, so reaching the app requires a sign-in, and `login()` calls
// resetQueryCache() regardless -- there is nothing a longer bound could preserve. Below 30 days
// there is a window where a still-valid session boots against a dead backend to an empty picker
// and cannot log anything, which is precisely the failure this exists to prevent.
//
// (One honest gap: offline, a token PAST expiry still boots from the auth snapshot, because /me
// cannot be reached to reject it. Such a device loses the cache at 30 days. Its queued writes would
// 401 on reconnect regardless, so it is already in a state only a fresh sign-in resolves.)
//
// Age is not freshness and nothing here treats it as such: a restored entry is still revalidated by
// the ordinary 60s staleTime the moment there is a network, offlineCacheWarm still force-refreshes
// the refreshAfterRestore keys on every boot, OfflineDataNotice still shows the person how old what
// they are looking at is, and QUERY_CACHE_BUSTER still discards the whole thing on a shape change.
// What changes is only whether there is anything to show while the server is unreachable.
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// gcTime is a DIFFERENT question from maxAge, and conflating them cost this file a wrong answer
// once already -- an earlier revision of the comment below claimed gcTime "must be >= the persister
// maxAge, or persisted entries would be garbage-collected out of the in-memory cache before they
// can be restored". That is not what gcTime does. Restore happens via hydrate() at boot and
// consults no timer; gcTime only decides how long an INACTIVE query survives in memory *during a
// session*, and the real requirement is therefore that it comfortably exceed a realistic continuous
// session -- otherwise queries evaporate mid-session and the next throttled persist writes them out
// of the blob. 20 days is absurdly beyond any session while leaving ~5 days of headroom under the
// ceiling below.
//
// That ceiling is `setTimeout`, and it is not a preference. TanStack schedules collection with
// `setTimeout(..., gcTime)` (see removable.js), and `isValidTimeout` rejects only non-numbers,
// negatives and Infinity -- so a delay above 2^31-1 ms (~24.85 days) passes the check and then
// OVERFLOWS the 32-bit timer, firing almost immediately instead. A 30-day gcTime therefore does the
// exact opposite of what it reads as: every inactive query evicted within a millisecond of losing
// its last observer, emptying what the persister then writes to disk. Node surfaces it as
// `TimeoutOverflowWarning: ... Timeout duration was set to 1`; browsers do it silently. Caught here
// on a first attempt at 30 days. maxAge is unaffected -- it is a plain `Date.now() - timestamp`
// comparison with no timer anywhere near it, which is exactly why the two can differ.
const GC_TIME_MS = 20 * 24 * 60 * 60 * 1000;

// 2^31-1 ms. Exported so the test guarding the overflow above cannot drift from the real limit.
export const MAX_SAFE_TIMEOUT_MS = 2147483647;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A moderate freshness window so returning to a view you saw recently paints instantly
      // and does NOT refetch (no refresh indicator, no value pop). Window-focus refetch only
      // refires queries that have actually gone stale past this.
      staleTime: 60 * 1000,
      // Long enough that an inactive query cannot evaporate mid-session; deliberately NOT tied to
      // the persister's maxAge, and bounded by setTimeout rather than by policy. See GC_TIME_MS.
      gcTime: GC_TIME_MS,
      retry: 2,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Reads are safe to retry a couple times; writes opt into their own retry policy (with an
      // idempotency key so a replay can't double-insert).
      retry: 0,
    },
  },
});

// Durable log-set defaults, registered by mutationKey so a mutation RESTORED from the offline outbox
// (functions don't serialize) can replay -- its mutationFn, retry, scope, and reconciliation are all
// re-attached from here at hydrate time. Everything the replay needs comes from serializable
// `variables`; nothing is captured from a component closure.
//
// Registered via a function (not inline) so a fresh client -- notably the per-test client in
// test/queryWrapper.jsx -- can be given the exact same defaults; tests pass `retry: false` so a
// mocked rejection surfaces immediately instead of running the production backoff.
export const LOG_SET_MUTATION_KEY = ['logSet'];
export const CREATE_EXERCISE_MUTATION_KEY = ['createExercise'];
export const EDIT_SET_MUTATION_KEY = ['editSet'];
export const DELETE_SET_MUTATION_KEY = ['deleteSet'];
export const SAVE_NOTE_MUTATION_KEY = ['saveNote'];
export const END_WORKOUT_MUTATION_KEY = ['endWorkout'];
export const FAVORITE_MUTATION_KEY = ['favorite'];

// Failure taxonomy (hardening #8) as a pure, testable predicate: a real 4xx is the server's answer
// -> stop, since retrying it can never succeed and (in the serial outbox scope) would otherwise
// block every write queued behind it forever. Anything else (a 5xx / cold-start 503 / timeout /
// gateway error == server unreachable, or a fetch reject with no status) is transient -> retry
// FOREVER with backoff rather than eventually dropping the write and going quiet. "Durable" means
// a connectivity problem can never be the reason a write is lost or silently stops trying; only a
// definitive rejection from the server can end retries. (Fully offline never reaches here --
// networkMode pauses the mutation before it errors.)
// Two 4xx codes are NOT the server's definitive answer -- they explicitly mean "try again":
//   408 Request Timeout -- an intermediary gave up waiting, typically because the backend was
//       cold-starting or its connection pool was saturated. Nothing about the write is wrong.
//   429 Too Many Requests -- a rate limit, which by definition expires.
// Treating either as definitive silently drops a durable write forever, which is precisely the
// thing "a connectivity problem can never be the reason a write is lost" exists to prevent.
// Latent rather than live today (bucket4j rate-limits only registration and password reset, never
// workout writes), but Azure ingress can emit both of its own accord, and any future rate limit on
// a write endpoint would make it live without touching this file. See
// docs/architecture/resilience.md, axis B.
const RETRYABLE_4XX = new Set([408, 429]);

// The server's code for "this login is paused because the household left Plus"
// (PermissionInterceptor.MEMBER_LOGIN_PAUSED). A contract with the backend, so the string is
// literal on both sides and each names the other.
export const MEMBER_LOGIN_PAUSED = 'MEMBER_LOGIN_PAUSED';

// `error.terminal` is the one non-HTTP way retries end, and it is deliberately NOT a network
// judgement: it is set only by the dependency check below, which asks a purely LOCAL question --
// "is the create this write depends on still in the mutation cache?". Nothing a backend does can
// reach it. That matters, because a hard-down/cold/overloaded backend emits every code there is
// (502, 503, 504, aborted timeouts, bare rejected fetches) and NONE of those say the write is bad;
// they all still retry forever below. A write whose dependency is gone is different in kind: no
// amount of waiting can produce the id it needs, and while it waits it holds the single serial
// outbox scope, so everything queued behind it stops too. Retrying it forever is what wedged the
// whole queue (docs/incidents/2026-09-04-outbox-wedged-by-orphaned-edit.md).
// Note this ENDS RETRIES; it does not discard. The write stays in the cache, stays persisted by
// outboxPersistence (which drops only `success`), and stays listed -- exactly like a definitive 4xx.
export function shouldRetryWrite(_failureCount, error) {
  if (error?.terminal) return false;
  const status = error?.status;
  if (status >= 400 && status < 500) return RETRYABLE_4XX.has(status);
  return true;
}

// "Has this write NOT reached the server yet?" -- the display counterpart to shouldRetryWrite
// above, and the single predicate every screen that renders unsynced writes must share.
//
// Deliberately NOT `status === 'pending'`: a write whose retries have settled against an
// unreachable server sits in 'error', but it is still queued, still durable, and still guaranteed
// to sync (shouldRetryWrite retries transient failures forever, and flushOutbox restarts stuck
// ones on reconnect). Hiding it would tell the person their set is gone while the outbox badge
// still counts it. Only two states mean "stop showing this": 'success' (it landed), and a
// definitive 4xx (the server's real answer, which onError has already rolled back).
//
// Takes the flat { status, errorStatus } shape so it works both on a raw Mutation
// (`{ status: m.state.status, errorStatus: m.state.error?.status }`) and on the projection
// useMutationState's `select` already produces.
//
// Note this answers a DIFFERENT question from useOutboxCount's "is it queued or struggling",
// which deliberately excludes a brand-new online first attempt so a fast successful write doesn't
// flash the banner. Don't unify those two.
// `errorTerminal` mirrors shouldRetryWrite's own first clause, so the two predicates stay in step:
// a write whose dependency can never arrive has already stopped retrying, exactly like a definitive
// 4xx, so it is not something a discard would destroy. Keeping it "unsynced" would make the logout
// guard warn about a write nothing can ever deliver.
// The 4xx test goes through RETRYABLE_4XX rather than a bare range check, so 408 and 429 land the
// same way here as they do in shouldRetryWrite: still retrying, therefore still unsynced. As a bare
// range this said "already reached the server" for two codes that explicitly mean "try again", so
// the logout guard would have discarded such a write without warning. Unreachable in practice --
// those keep retrying and so never settle into 'error' -- but the two predicates disagreeing is
// exactly the drift the pinned agreement test below exists to prevent.
export function isUnsyncedWrite({ status, errorStatus, errorTerminal }) {
  if (status === 'success') return false;
  if (status === 'error' && errorTerminal) return false;
  return !(status === 'error' && errorStatus >= 400 && errorStatus < 500 && !RETRYABLE_4XX.has(errorStatus));
}

// "Is this queued write dead -- past the point where waiting or reconnecting could ever land it?"
//
// The single place the UI asks that question, so the modal's badge and the retry policy can never
// disagree about what "stuck" means. Deliberately NARROW: a write retrying against a 5xx, a
// timeout, a cold start or an unreachable backend is not dead, it is waiting, and under those
// conditions shouldRetryWrite keeps it 'pending' so it never even reaches here.
//
// 401 is excluded on purpose. A forced 401 deliberately PRESERVES the outbox (see AuthContext) and
// flushOutbox replays it after the next sign-in, so a write rejected for an expired session is
// recoverable -- badging it "couldn't sync" would call a write dead that is one login away from
// landing.
export function isDeadWrite({ status, errorStatus, errorCode, errorTerminal }) {
  if (status !== 'error') return false;
  if (errorTerminal) return true;
  if (errorStatus === 401) return false;
  // ⚠️ A paused member login's 403 means the OPPOSITE of every other 403 here. The household went
  // back to Free, so the write is refused -- but nothing was deleted and the membership still
  // exists, so the moment they are Plus again flushOutbox re-executes it and the work lands. Same
  // carve-out and same reasoning as 401 above: both are "not right now", not "never".
  //
  // Reported dead, a member who logged sets before the plan lapsed would be told those sets can
  // never sync, and offered the discard that makes it true.
  if (errorCode === MEMBER_LOGIN_PAUSED) return false;
  return errorStatus >= 400 && errorStatus < 500 && !RETRYABLE_4XX.has(errorStatus);
}

// Thrown by a dependent write's mutationFn (log-set, note, favorite) when the exercise id it needs
// is still an unresolved temp id -- i.e. the exercise-create it depends on hasn't synced yet. It
// never carries a `.status`, so it is never mistaken for a server answer, and the raw
// "temp-exercise-<uuid>" string never reaches the wire: the backend's exerciseId field is a Long,
// so that request can never succeed and previously surfaced as a malformed-request failure that
// (before the backend fix) collapsed into a session-killing 401.
//
// `terminal` is what decides whether waiting can help, and it is set from dependencyIsGone below
// rather than from anything the network did. Not terminal (the create is still queued) ->
// shouldRetryWrite keeps retrying, which is how the dependent waits for its dependency. Terminal
// (the create is cancelled or has itself terminally failed) -> retries end, because no amount of
// waiting produces the id and the retry loop would hold the serial outbox scope forever.
class UnresolvedExerciseIdError extends Error {
  constructor(tempId, terminal) {
    super(
      terminal
        ? `Exercise ${tempId} will never sync -- the create it depends on is gone`
        : `Exercise ${tempId} has not finished syncing yet`,
    );
    this.name = 'UnresolvedExerciseIdError';
    this.terminal = terminal;
  }
}

// "Could the create that would map this temp id still run?" -- a purely LOCAL question about the
// mutation cache, deliberately not a network one, so no backend condition can influence the answer.
//
// Retrying an unresolved temp id forever is correct while the create is still queued: the shared
// serial scope guarantees it replays first, and the retry is what waits for it. It is catastrophic
// once the create can no longer run, because a 'pending' mutation never releases that scope -- the
// entire outbox stops, permanently, including writes made later while fully online.
//
// Two ways a create stops being able to run, and both are terminal for anything depending on it:
//   - It is GONE from the cache. Cancelled by cancelQueuedWritesForSet (deleting a not-yet-synced
//     set), or evicted. Nothing will ever record the mapping. This is the reported bug:
//     docs/incidents/2026-09-04-outbox-wedged-by-orphaned-edit.md.
//   - It is in a terminal 'error' state -- a definitive 4xx (a quota 403 on an exercise create, a
//     400 on an unknown trackingType). Its own retries have ended, so the mapping is not coming.
//
// The second is still recoverable rather than final, which is why this ends RETRIES and never
// discards: flushOutbox re-executes EVERY errored outbox mutation on the next reconnect/visibility/
// login, in byEnqueueOrder -- so if the create later succeeds (a 401 followed by a re-login, say),
// the dependent is re-executed in the same pass, resolves, and lands. Nothing that could have
// succeeded is lost; it simply stops holding the queue hostage while it waits.
function dependencyIsGone(client, kind, tempId) {
  const create = client
    .getMutationCache()
    .getAll()
    .find((m) => m.options.mutationKey?.[0] === kind && m.state.variables?.tempId === tempId);
  if (!create) return true;
  return create.state.status === 'error';
}

function requireResolvedExerciseId(client, id) {
  const resolved = resolveExerciseId(id);
  if (isTempExerciseId(resolved)) {
    throw new UnresolvedExerciseIdError(resolved, dependencyIsGone(client, 'createExercise', resolved));
  }
  return resolved;
}

// Same shape as UnresolvedExerciseIdError, for a durable edit dispatched against a set that hasn't
// synced yet -- see EDIT_SET_MUTATION_KEY below and offlineSetEdits.js's setIdMap-based redesign
// (an edit to a still-queued set is now a genuinely separate write targeting the create's tempId,
// never a mutation of the queued create itself -- TanStack has no public way to update or cancel an
// in-flight mutation, and mutating the create in place risks the backend's idempotency dedup
// silently discarding the edit if the original create had already reached the server).
class UnresolvedSetIdError extends Error {
  constructor(tempId, terminal) {
    super(
      terminal
        ? `Set ${tempId} will never sync -- the set it edits is gone`
        : `Set ${tempId} has not finished syncing yet`,
    );
    this.name = 'UnresolvedSetIdError';
    this.terminal = terminal;
  }
}

// "Has someone deleted this set, with the delete still queued?" -- matched on the id the delete was
// DISPATCHED with, which for a set deleted mid-save is its create's tempId (offlineSetEdits.js's
// deleteQueuedSet). A create in that state is still pending, so every reader that renders or counts
// pending creates asks this, or a set someone just deleted reappears until its create lands and the
// delete behind it runs. Any status counts: a settled delete means the create settled too, and a
// settled create is no longer read as pending by anything.
export function isDeleteQueuedFor(client, setId) {
  return client
    .getMutationCache()
    .getAll()
    .some((m) => m.options.mutationKey?.[0] === DELETE_SET_MUTATION_KEY[0] && m.state.variables?.setId === setId);
}

// The session a set's create landed in, read off that create's own response -- for a write that
// targeted the set by tempId before any session existed. Null if the create never landed or has been
// collected, which leaves the caller no worse off than not asking.
function landedSessionOf(client, tempId) {
  const create = client
    .getMutationCache()
    .getAll()
    .find((m) => m.options.mutationKey?.[0] === LOG_SET_MUTATION_KEY[0] && m.state.variables?.tempId === tempId);
  return create?.state.data?.session?.id ?? null;
}

function requireResolvedSetId(client, id) {
  const resolved = resolveSetId(id);
  if (isTempSetId(resolved)) {
    throw new UnresolvedSetIdError(resolved, dependencyIsGone(client, 'logSet', resolved));
  }
  return resolved;
}

// Trends is derived entirely from logged sets, so any set write makes every cached range and every
// cached per-exercise curve wrong. It was previously left out of these handlers alongside `prs` and
// `history`, and with staleTime at 60s that meant logging your very first set and opening Trends
// still showed "No workouts logged yet" for a minute.
//
// This is invalidation, not prefetching -- deliberately unlike offlineCacheWarm.js, which skips
// trends because *warming* them is a high-cost fan-out across every household member. Marking them
// stale costs nothing: Trends isn't mounted while you're logging, so no refetch fires until the tab
// is actually opened.
// ⚠️ CANCEL, THEN INVALIDATE -- a bare invalidation is swallowed during a first load.
//
// TanStack v5's Query#fetch cancels an in-flight fetch only when the query already HAS data. During
// a FIRST load it joins the request already running instead (query-core's `fetch`: `if (data !==
// undefined && cancelRefetch) cancel(); else return this.#retryer.promise`). Trends is the one tab
// offlineCacheWarm deliberately does not warm, so opening it is always a first load -- and a set
// whose save lands during that load had its invalidation absorbed: the load's answer, fetched before
// the set existed, arrived, marked the query fresh, and stood for the full 60s staleTime. Trends
// said "No workouts logged yet" mid-workout (lower's records-table retries, four specs,
// docs/incidents/2026-09-24-trends-first-load-swallows-invalidation.md).
//
// Cancelling first reverts an in-flight first load to "no data yet", so the invalidation then
// starts a genuinely new request. With data already cached it changes nothing (invalidation
// cancels and refetches there anyway), with nothing in flight the cancel is a no-op, and a paused
// fetch is cancelled and simply paused again -- one code path in every mode.
//
// Safe HERE because nothing ever writes optimistic data into a trends key: a cancel reverts the
// query to its state from before the fetch began, so on a key that is seeded mid-fetch (LOG_SET's
// sessionSets / exerciseSummary seeds, below) the same pattern would throw that seed away. Do not
// generalize it to those keys. See frontend-core.md.
function invalidateTrends(client, personId) {
  for (const queryKey of [
    queryKeys.trendsForPerson(personId),
    queryKeys.exerciseTrendsForPerson(personId),
    queryKeys.exerciseRecordsForPerson(personId),
  ]) {
    client.cancelQueries({ queryKey }).then(() => client.invalidateQueries({ queryKey }));
  }
}

// The PRs board, after a write that changed it -- the same first-load race as invalidateTrends, from
// a different direction. `prs` IS warmed (offlineCacheWarm), so its first load is usually the boot
// warm itself: on a new household, or whenever the warm runs before the cache holds `prs`, a set
// that lands while that warm is in flight had its invalidation absorbed. The warm's answer, computed
// before the set existed, was then fresh for the full staleTime: "No PRs yet", or a board missing
// the set just logged. On lower that was parity-pr-record and both offline-reads PRs specs needing
// retries (e2e/tests/prs-first-load.spec.ts pins the order).
//
// Safe for the same reason as trends: nothing writes optimistic data into a `prs` key, so a cancel
// that reverts it to its pre-fetch state throws nothing away.
function invalidatePrs(client, personId) {
  const queryKey = queryKeys.prs(personId);
  client.cancelQueries({ queryKey }).then(() => client.invalidateQueries({ queryKey }));
}

// History after a write that changed it -- the ONE way every writer refreshes it. Three steps, and
// each closes a way History could be left showing something the server no longer says:
//
//  1. CANCEL any History fetch already in flight. It began before this write reached the server, and
//     when nothing is observing the query (the Log tab only fetches History during a live workout,
//     so right after an End there is often only its disabled observer) TanStack does not cancel it
//     on invalidation -- it lets it finish, stores its now-outdated answer as fresh, and clears the
//     invalidation. Found by the parity convergence check (e2e/tests/support/historyConvergence.ts):
//     ending a workout mid-save in any degraded mode left History showing it in progress for the
//     whole staleTime. Safe on this key for the reason invalidateTrends gives: History has no
//     optimistic writer, so a cancel's revert throws nothing away.
//  2. INVALIDATE, so that if the fetch below cannot complete (paused offline, failing in lie-fi) the
//     next screen to read History still refetches it rather than trusting the old copy.
//  3. FETCH NOW, observed or not. An unobserved History is exactly what the next offline stretch
//     reads -- "Last time", the prefill and the record fold all come from it -- so it must learn about
//     this write while it can. This used to be too costly to do on every write; with the month sync
//     an unchanged month costs a fingerprint, not a download.
//
// Fire-and-forget: a failed or paused fetch is simply retried by the next trigger, and the query keeps
// the months it has. One code path in every mode.
//
// `scope` (historyScopeFor) makes step 3 a SCOPED sync: after a write on this device, only the months
// of the workout it touched are checked and reloaded -- a few hundred milliseconds on lower instead of
// an all-months fingerprint check twice over. Every other month is left as held and re-verified by
// the next ordinary sync: app open, refocus, the periodic warm, the History tab mounting stale, the
// daily full sync. A change made on ANOTHER device in another month therefore reaches this one then,
// not now -- the accepted cost (docs/architecture/history-sync.md, "Scoped syncs"). No scope, or a
// device due its full sync, is the ordinary all-months sync.
//
// ⚠️ A refresh's scope is OWED until a refresh completes. Step 1 cancels the fetch before it, so
// without this a quick second write took the first write's months down with it: edit a set in an
// August workout, log one in today's September workout a moment later (or have both drain from the
// outbox together), and the September sync replaced the August one. August then showed the old set
// -- and the query was marked fresh, so nothing refetched it -- until the next ordinary sync. So each
// refresh adds its scope to what is still owed; an ordinary refresh owed, or a union past the
// server's bound, makes the debt ordinary. A failed or paused refresh stays owed for the next one.
//
// The request reads the debt when it GOES OUT, not when the refresh was asked for: two refreshes in
// one tick both cancel before either fetches, and the second fetchQuery then joins the first's
// request rather than starting its own -- so that request must already carry both scopes.
//
// ⚠️ A fetch begun ELSEWHERE that step 1 cancels was an ORDINARY sync -- the boot warm on app open,
// a refocus, the periodic warm -- re-verifying every month, including ones changed on another
// device. Cancelling it owes an ordinary sync, not this write's months. On lower, an app opened with
// a set queued offline cancelled its own boot sync this way and threw away another device's change to
// August, whose answer had already arrived, until the next ordinary sync. Only a fetch this helper
// started (tracked by `inFlight`) carries the debt; any other in flight, or paused offline, makes the
// debt ordinary.
export function refreshHistory(client, personId, scope = null) {
  const queryKey = queryKeys.history(personId);
  const { owed, inFlight } = historyRefreshState(client);
  const cancellingOrdinarySync =
    (client.getQueryState(queryKey)?.fetchStatus ?? 'idle') !== 'idle' && !inFlight.has(personId);
  const adding = cancellingOrdinarySync ? null : scope;
  owed.set(personId, { scope: owed.has(personId) ? mergeHistoryScopes(owed.get(personId).scope, adding) : adding });
  // Returned for a caller that awaits a batch of fetches (offlineCacheWarm); it never rejects.
  return client
    .cancelQueries({ queryKey })
    .then(() => {
      client.invalidateQueries({ queryKey, refetchType: 'none' });
      return client.fetchQuery({
        queryKey,
        queryFn: async () => {
          const paying = owed.get(personId) ?? { scope: null };
          inFlight.set(personId, paying);
          try {
            const data = await getHistory(personId, { readCached: () => client.getQueryData(queryKey), scope: paying.scope });
            // Paid -- unless a later refresh took the debt over meanwhile (and cancelled this request).
            if (owed.get(personId) === paying) owed.delete(personId);
            return data;
          } finally {
            if (inFlight.get(personId) === paying) inFlight.delete(personId);
          }
        },
        staleTime: 0,
      });
    })
    .catch(() => {});
}

// HistorySyncRequest bounds `sessions` and `at` to 8 each; a union past that is an ordinary sync.
const HISTORY_SCOPE_MAX = 8;

// Per person: `owed`, the debt; `inFlight`, the debt a request of refreshHistory's own is carrying
// right now. Per QueryClient, so a test's client (or a signed-out one) never inherits another's.
const historyRefreshStateByClient = new WeakMap();

function historyRefreshState(client) {
  let state = historyRefreshStateByClient.get(client);
  if (!state) {
    state = { owed: new Map(), inFlight: new Map() };
    historyRefreshStateByClient.set(client, state);
  }
  return state;
}

// null is the ordinary all-months sync, which already covers any scope.
function mergeHistoryScopes(a, b) {
  if (a == null || b == null) return null;
  const sessions = [...new Set([...a.sessions, ...b.sessions])];
  const at = [...new Set([...a.at, ...b.at])];
  if (sessions.length > HISTORY_SCOPE_MAX || at.length > HISTORY_SCOPE_MAX) return null;
  return { sessions, at };
}

// The scope of a write on this device: the workout it touched, with every start time this device
// knows for it -- the one the write's own response gave (`startedAtFromWrite`, when it gave one) and
// the one the cached History or live session holds. The server adds the month the workout is in NOW,
// so a workout moved elsewhere is reloaded in both places. Null -- the ordinary all-months sync --
// when the workout is not known yet (a set still waiting for its session) or is a client-side temp id.
export function historyScopeFor(client, personId, sessionId, startedAtFromWrite = null) {
  if (sessionId == null || !Number.isFinite(Number(sessionId))) return null;
  const at = new Set();
  if (startedAtFromWrite) at.add(startedAtFromWrite);
  const held = client.getQueryData(queryKeys.history(personId));
  for (const session of flattenHistory(held)) {
    if (String(session.id) === String(sessionId) && session.startedAt) at.add(session.startedAt);
  }
  const live = client.getQueryData(queryKeys.liveSession(personId));
  if (live?.id != null && String(live.id) === String(sessionId) && live.startedAt) at.add(live.startedAt);
  return { sessions: [Number(sessionId)], at: [...at] };
}

// For the writes that change EVERY person's History at once -- an exercise rename (History carries
// names) and a plan change (the Free window clamps everyone): refreshHistory for each person whose
// History this device holds.
export function refreshHistoryForEveryone(client) {
  for (const query of client.getQueryCache().findAll({ queryKey: queryKeys.historyForEveryone() })) {
    if (query.queryKey.length === 2 && query.queryKey[1] != null) refreshHistory(client, query.queryKey[1]);
  }
}

// A bulk import (or its undo) rewrites more of a person's history in one go than any other write
// in the app -- new sets, new workouts, sometimes new exercises and tags -- so everything derived
// from sets has to be marked stale, not just the keys a single log-set touches.
//
// Undo calls this too: it changes exactly the same set of views, in the other direction.
//
// The list is the same one reconcileSetChange answers for, plus the two account-shared catalogs an
// import can add to. If you add a read derived from logged sets, it belongs in both places -- ask
// "if someone imports a file and opens this view five seconds later, is it right?"
export function invalidateAfterImport(client, personId) {
  refreshHistory(client, personId);
  invalidatePrs(client, personId);
  client.invalidateQueries({ queryKey: queryKeys.historyWindow(personId) });
  // ⚠️ THE ROSTER DERIVES FROM SETS TOO, and it is account-shared rather than person-keyed -- so a
  // set logged for ANY person changes it. Invalidated by PREFIX because the key carries a weeks
  // window this caller cannot know (queryKeys.roster(weeks)).
  //
  // It was missing here when the roster shipped, and the symptom was exactly what
  // frontend-core.md warns about: log a set, open the roster, and it still says that client has
  // never trained -- for up to a minute, because offlineCacheWarm had already cached the old
  // answer. An e2e caught it; nothing about the screen looked wrong.
  client.invalidateQueries({ queryKey: ['roster'] });
  client.invalidateQueries({ queryKey: queryKeys.personExercises(personId) });
  client.invalidateQueries({ queryKey: queryKeys.exercises() });
  client.invalidateQueries({ queryKey: queryKeys.tags() });
  // Session-scoped keys carry a session id this caller cannot know (an import writes many), so
  // they're invalidated by prefix rather than by exact key.
  client.invalidateQueries({ queryKey: ['session-sets'] });
  client.invalidateQueries({ queryKey: ['exercise-summary', personId] });
  invalidateTrends(client, personId);
}

export function registerOfflineMutationDefaults(client, { retry } = {}) {
  client.setMutationDefaults(LOG_SET_MUTATION_KEY, {
    // One shared scope => queued writes replay STRICTLY SERIALLY in enqueue order (hardening #2), so
    // sets land in order (keeping rest_seconds honest) and, later, an exercise-create replays before
    // the sets that depend on it. It's also the marker the outbox persister uses to decide which
    // paused mutations are durable (i.e. have a registered replayable mutationFn).
    scope: { id: OUTBOX_SCOPE_ID },
    mutationFn: (vars) => {
      const payload = {
        // Resolve a temp exercise id (a set logged offline against a just-created, not-yet-synced
        // exercise) to its real server id, now known because the create replayed first -- the shared
        // serial scope guarantees that ordering (PR 4). A normal numeric id passes through unchanged.
        // If the create hasn't synced yet (still resolves to a temp id), this throws instead of
        // sending the server a string it can't parse as a Long -- see requireResolvedExerciseId.
        exerciseId: requireResolvedExerciseId(client, vars.exerciseId),
        weight: vars.weight,
        reps: vars.reps,
        durationSeconds: vars.durationSeconds,
        idempotencyKey: vars.idempotencyKey,
        clientLoggedAt: vars.clientLoggedAt,
      };
      return vars.mode === 'session'
        ? logSetIntoSession(vars.sessionId, payload)
        : logLiveSet(vars.personId, payload);
    },
    // Failure taxonomy (hardening #8) -- see shouldRetryWrite. Tests pass `retry: false` to fail fast.
    retry: retry ?? shouldRetryWrite,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    // Runs for BOTH an interactive log and a restored/replayed one (which has no component observer),
    // so History/PRs/sets reconcile to server truth once a queued write finally syncs. Uses the
    // server's returned session id when present (a live set's session may not exist at dispatch).
    onSettled: (data, _error, vars) => {
      // Record the temp->real set id mapping on success, so any EDIT_SET queued against this set's
      // tempId (see offlineSetEdits.js) resolves correctly once it replays -- mirrors
      // CREATE_EXERCISE's onSettled below recording the temp->real EXERCISE id mapping.
      if (data?.set?.id && vars.tempId) {
        setSetIdMapping(vars.tempId, data.set.id);
      }
      const sessionId = data?.session?.id ?? vars.sessionId ?? null;
      // Reconcile FROM THE RESPONSE, before invalidating -- rather than refetching to discover what
      // the response already told us. Without this the FIRST set of a workout vanished for two
      // sequential round trips: it left ExerciseDetail's pendingBeforeSession the instant the
      // mutation reported success, while contextSessionId was still null (awaiting a liveSession
      // refetch) and sessionSets had not yet been fetched under the newly-created session's key.
      //
      // `data` is non-undefined ONLY when the server returned a success body, so this whole block is
      // unreachable while paused offline (never settles), during lie-fi or on a definitive 4xx
      // (settles with data === undefined), and against a 5xx/cold start (retries forever, settling
      // only on eventual success). Degraded behaviour is therefore unchanged: pendingBeforeSession
      // stays the sole source of those rows for a person's entire outage.
      if (data?.set?.id && data?.session?.id) {
        // The live session's real id, straight from the write that created it. LogSetResultDto
        // carries the same WorkoutSessionDto record GET /people/{id}/sessions/live returns, so this
        // is exactly the value a refetch would have produced -- no shape drift, and an honest
        // dataUpdatedAt, since it is server data rather than something the client invented.
        //
        // NEVER for mode 'session': that response carries the PAST session being edited, which is
        // not this person's live session. Same guard as the invalidation below.
        //
        // isSessionEnded stops a write replaying after End Workout from resurrecting a finished
        // session. useLiveSession already suppresses that on read; this keeps a stale copy from
        // being written and persisted in the first place.
        //
        // And a set logged before its workout was ENDED -- the End tap came while this create was
        // still pending, so there was no id to mark then (endedSessions.js#markCreatesEnded). Its
        // session is marked now, before anything can treat it as live: this write is skipped, and
        // useLiveSession suppresses the same id when the invalidation below fetches it back.
        if (vars.mode !== 'session' && isCreateInEndedWorkout(vars.personId, vars.tempId)) {
          markSessionEnded(vars.personId, data.session.id);
          // History must be FETCHED here, not merely invalidated: this is the one path where a set
          // lands for a workout that never becomes live on this device, and the Log tab only
          // fetches history while a workout is live (LogTab's `fetch: !!activeSessionId`) -- so an
          // invalidation alone reached no observer that acts on it, History never learned the
          // workout existed, and the next workout's first set was judged the first ever ("New PR! ·
          // Most reps"). refreshHistory, at the end of this handler, fetches whether or not anything
          // observes the query, which is what this branch used to prefetch by hand -- and it also
          // cancels a fetch still in flight from before the End reached the server, which the old
          // prefetch did not.
        }
        if (vars.mode !== 'session' && !isSessionEnded(vars.personId, data.session.id)) {
          client.setQueryData(queryKeys.liveSession(vars.personId), data.session);
        }
        // Seed the confirmed row so the list is never empty between the write succeeding and the
        // invalidation's refetch landing. THREE cases, and conflating them duplicates rows:
        //   - already reconciled (a row with this server id) -> leave alone
        //   - an optimistic row from onMutate (set 2+, or session-edit mode, where onMutate DID
        //     have a session id to write against) -> REPLACE IN PLACE, keeping its position
        //   - no row at all (the first set of a new workout, where onMutate had no key to write
        //     to) -> append
        // `tempId` rides along so ExerciseDetail can hold one React key across the
        // optimistic -> confirmed swap instead of unmounting the row and replaying its flash.
        //
        // Unless the set was deleted while this create was still on its way: its DELETE_SET is
        // queued right behind (isDeleteQueuedFor), and seeding the row here would bring it back
        // on screen until that delete lands.
        client.setQueryData(queryKeys.sessionSets(sessionId, vars.exerciseId), (old) => {
          const rows = old ?? [];
          if (isDeleteQueuedFor(client, vars.tempId)) return rows;
          if (rows.some((r) => r.id === data.set.id)) return rows;
          const confirmed = { ...data.set, tempId: vars.tempId };
          const idx = rows.findIndex((r) => r.id === vars.tempId);
          if (idx === -1) return [...rows, confirmed];
          const next = rows.slice();
          next[idx] = confirmed;
          return next;
        });
        // The same contextSessionId null -> real flip cold-keys the summary, which is what dropped
        // the "Last time"/"Best" cards to skeletons and blinked the weight/reps steppers through an
        // em dash (prefill derives from summary.lastSession). Carry the previous key's value across
        // rather than render a loading state over an answer already in hand; the invalidation
        // immediately below revalidates it.
        //
        // This is the IDENTICAL answer, not an approximation. StatsService#getSummary takes the
        // session id as `excludeSessionId` and getLastSession skips that session's sets, so the
        // value under the new key means "most recent session OTHER than the one just created" --
        // and the cached null-key value was fetched before that session existed, so it already is
        // that. (`best` ignores the parameter entirely and is stale by exactly the set just logged,
        // which is precisely what ExerciseDetail's mergeBestWithLocalSets already folds in.)
        //
        // Live path only, and only into a key holding nothing: for mode 'session' the id was known
        // all along, so no null-keyed value belongs under it.
        if (vars.mode !== 'session') {
          const summaryKey = queryKeys.exerciseSummary(vars.personId, vars.exerciseId, sessionId);
          if (client.getQueryData(summaryKey) === undefined) {
            const carried = client.getQueryData(queryKeys.exerciseSummary(vars.personId, vars.exerciseId, null));
            if (carried !== undefined) client.setQueryData(summaryKey, carried);
          }
        }
      }
      client.invalidateQueries({ queryKey: queryKeys.sessionSets(sessionId, vars.exerciseId) });
      client.invalidateQueries({ queryKey: queryKeys.exerciseSummary(vars.personId, vars.exerciseId, sessionId) });
      if (vars.mode !== 'session') {
        client.invalidateQueries({ queryKey: queryKeys.liveSession(vars.personId) });
      }
      invalidatePrs(client, vars.personId);
      // Scoped to the workout this set went to (its month, and wherever it is now) -- see
      // refreshHistory. The response carries the session, so its start time is exact.
      refreshHistory(client, vars.personId,
        historyScopeFor(client, vars.personId, sessionId, data?.session?.startedAt ?? null));
      // Derived from sets like the three above: logging into an out-of-window past session is how
      // the hidden count goes 0 -> 1, and that is the exact flow the notice exists for.
      client.invalidateQueries({ queryKey: queryKeys.historyWindow(vars.personId) });
  // ⚠️ THE ROSTER DERIVES FROM SETS TOO, and it is account-shared rather than person-keyed -- so a
  // set logged for ANY person changes it. Invalidated by PREFIX because the key carries a weeks
  // window this caller cannot know (queryKeys.roster(weeks)).
  //
  // It was missing here when the roster shipped, and the symptom was exactly what
  // frontend-core.md warns about: log a set, open the roster, and it still says that client has
  // never trained -- for up to a minute, because offlineCacheWarm had already cached the old
  // answer. An e2e caught it; nothing about the screen looked wrong.
  client.invalidateQueries({ queryKey: ['roster'] });
      invalidateTrends(client, vars.personId);
    },
  });

  // Durable "create your own exercise" (PR 4). One mutation does the two dependent server calls --
  // create the exercise, then auto-favorite it -- both idempotent (create dedupes on idempotencyKey;
  // favorite is an idempotent PUT), so a replay can't duplicate. On success it records the temp->real
  // id mapping so any set-logs queued against the temp id resolve correctly, and refreshes the
  // catalog/picker so the real exercise takes the optimistic temp one's place.
  client.setMutationDefaults(CREATE_EXERCISE_MUTATION_KEY, {
    scope: { id: OUTBOX_SCOPE_ID },
    mutationFn: async (vars) => {
      const created = await addExercise({
        name: vars.name,
        idempotencyKey: vars.idempotencyKey,
        // Must ride along: without it a timed exercise created offline replays as 'strength', and
        // every hold queued against it is then rejected with a 400 on sync -- which shouldRetryWrite
        // treats as terminal, so those sets would be destroyed rather than retried.
        trackingType: vars.trackingType,
      });
      if (vars.personId) await favoriteExercise(vars.personId, created.id);
      return created;
    },
    retry: retry ?? shouldRetryWrite,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onSettled: (created, _error, vars) => {
      if (created?.id) {
        setExerciseIdMapping(vars.tempId, created.id);
        // Swap the optimistic row for the confirmed one IN PLACE, *before* invalidating -- the same
        // reconcile-from-the-response rule LOG_SET follows above, and for the same reason.
        //
        // LogTab's selection migrates from the temp id to the real one the moment this mutation
        // reports success, but an invalidation only marks the two keys stale: the real row does not
        // arrive until its refetch completes a round trip later. For that whole window neither id is
        // in the cache, so `selectedExercise` resolves to null, ExerciseDetail UNMOUNTS, and the Log
        // tab drops back to the picker -- swallowing whatever the person was mid-tap on (it ate the
        // first tap on the Time field of a just-created timed exercise, which is how it was found).
        //
        // `created` is the server's own ExerciseDto, so this is exactly what the refetch will
        // return; the invalidations below still run and revalidate it. The per-person overlay
        // (isFavorite/tags) is preserved from the optimistic row, since ExerciseDto doesn't carry it.
        //
        // It must NEVER build the entry, only reconcile one that already exists. A create replayed
        // from the outbox has no component behind it, and the query cache it was queued against may
        // be gone -- cleared on an auth change, or dropped by the maxAge / buster bump the
        // OUTBOX deliberately does not share. Building here would leave a catalog holding exactly
        // this one exercise, stamped as freshly fetched: online the invalidation below fixes it in a
        // round trip, but with no observer to refetch (the replay can land on any tab), or offline
        // before that lands, it stands as the person's entire exercise library.
        const swapInConfirmed = (rows) => {
          if (rows === undefined) return undefined;
          const idx = rows.findIndex((e) => e.id === vars.tempId);
          if (idx === -1) return rows.some((e) => e.id === created.id) ? rows : [...rows, created];
          const next = rows.slice();
          const merged = { ...rows[idx], ...created };
          // The row is confirmed now. Leaving the optimistic marker on it would say otherwise to any
          // future reader (today only SETS consult that flag, so this is honesty, not a live bug).
          delete merged.optimistic;
          next[idx] = merged;
          return next;
        };
        client.setQueryData(queryKeys.exercises(), swapInConfirmed);
        client.setQueryData(queryKeys.personExercises(vars.personId), swapInConfirmed);
        client.invalidateQueries({ queryKey: queryKeys.exercises() });
        client.invalidateQueries({ queryKey: queryKeys.personExercises(vars.personId) });
      }
    },
  });

  // The rest of the active-workout loop, all durable (outbox scope) so they queue offline and replay
  // in order. `durable` factors out the shared scope + failure-taxonomy retry/backoff.
  const durable = (extra) => ({
    scope: { id: OUTBOX_SCOPE_ID },
    retry: retry ?? shouldRetryWrite,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    ...extra,
  });

  // `sessionId` is an EXPLICIT parameter rather than something read off `vars`, because the id a
  // set-change write captured at DISPATCH time is null in precisely the case this whole design
  // exists to serve: correcting a set logged before its session existed. `contextSessionId` stays
  // null for a person's entire outage (ExerciseDetail.jsx), so an edit queued then carries
  // `sessionId: null` forever, while the row the user is looking at is read from
  // `session-sets(<real id>, ex)` once the create syncs and materializes the session.
  //
  // Invalidating the null key marked an empty, unobserved query stale and left the real one FRESH
  // -- so a correction that had already committed server-side stayed invisible until that query
  // went stale on its own 60s later. It presented as the edit being silently lost (it was not: the
  // server had it all along), intermittently, because it only shows when LOG_SET's own refetch of
  // the real key wins the race against the edit committing. Full account, including the three
  // wrong conclusions it produced first:
  // docs/incidents/2026-07-30-editing-queued-offline-set.md ("Follow-up (2026-08-18)").
  const reconcileSetChange = (vars, sessionId) => {
    client.invalidateQueries({ queryKey: queryKeys.sessionSets(sessionId, vars.exerciseId) });
    client.invalidateQueries({ queryKey: queryKeys.exerciseSummary(vars.personId, vars.exerciseId, sessionId) });
    invalidatePrs(client, vars.personId);
    refreshHistory(client, vars.personId, historyScopeFor(client, vars.personId, sessionId));
    client.invalidateQueries({ queryKey: queryKeys.historyWindow(vars.personId) });
    // The roster derives from sets as well -- editing or deleting one moves a person's "last
    // trained" and their adherence count. Prefix, because the key carries a weeks window.
    client.invalidateQueries({ queryKey: ['roster'] });
    invalidateTrends(client, vars.personId);
  };

  // Edit a set's weight/reps. Also reachable against a set that hasn't synced yet -- correcting a
  // still-queued offline set is now a genuinely separate durable write targeting the create's tempId
  // (see offlineSetEdits.js), never a mutation of the queued create itself, so setId resolves through
  // the same temp-id map exerciseId does above. A real numeric id (the common, already-synced case)
  // passes through unchanged. If the create hasn't synced yet (still resolves to a temp id), this
  // throws instead of sending the server a string it can't parse as a Long -- see requireResolvedSetId
  // -- and the shared serial outbox scope guarantees the create replays first, exactly like
  // requireResolvedExerciseId above. Idempotent (same value re-applied).
  client.setMutationDefaults(EDIT_SET_MUTATION_KEY, durable({
    // A 404 is treated as done, exactly as DELETE_SET below does, and for the same reason: the row
    // is gone, so there is nothing left for this edit to apply to. Reachable whenever another
    // device or tab deleted the set while this correction sat in the outbox. Left as an error it
    // never leaves the queue -- outboxPersistence drops only 'success' -- so the banner reads
    // "1 change waiting to sync" forever and flushOutbox re-fires a doomed PATCH on every
    // reconnect, tab-focus and login.
    //
    // This is the ONLY place a write leaves the outbox on something the server said, so it is worth
    // being precise about what it costs: a 404 requires the server to have actually ANSWERED. A
    // down, cold, timing-out or unreachable backend produces a rejected fetch, an abort, or a
    // 5xx/gateway error -- never a 404 -- and every one of those keeps retrying via
    // shouldRetryWrite. So no degraded condition can reach this branch.
    mutationFn: async (vars) => {
      const setId = requireResolvedSetId(client, vars.setId);
      try {
        return await editSet(setId, {
          weight: vars.weight,
          reps: vars.reps,
          durationSeconds: vars.durationSeconds,
        });
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    },
    // From the RESPONSE first -- WorkoutSetDto carries the set's real `sessionId`, which is the only
    // reliable answer when this edit was queued before the session existed. Same idiom LOG_SET
    // (`data?.session?.id`) and SAVE_NOTE (`data?.sessionId`) already use, for the same reason.
    // `data` is undefined whenever the server did not answer, and then there is nothing to
    // reconcile against anyway -- the write has not landed and will retry.
    onSettled: (data, _e, vars) => reconcileSetChange(vars, data?.sessionId ?? vars.sessionId ?? null),
  }));

  // Delete a set. A replay of an already-applied delete comes back 404 -- that's the intended end
  // state (already gone), so treat it as success rather than a stuck error (hardening).
  //
  // Also reachable against a set whose create has not landed yet, exactly like EDIT_SET above:
  // offlineSetEdits.js's deleteQueuedSet targets the create's tempId whenever the create may
  // already have left the device, because cancelling it then cannot un-send it -- the request lands
  // anyway and the "deleted" set survives on the server
  // (docs/incidents/2026-09-23-remove-mid-save-deleted-nothing.md). The shared serial scope runs
  // the create first; this resolves its id once it has, and a create that can never land ends this
  // write's retries through the same dependencyIsGone check an orphaned edit gets.
  client.setMutationDefaults(DELETE_SET_MUTATION_KEY, durable({
    mutationFn: async (vars) => {
      const setId = requireResolvedSetId(client, vars.setId);
      try {
        return await deleteSet(setId);
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    },
    // No response to read a session id from (the endpoint is 204). `vars.sessionId` is the real id
    // for a synced target, but null for a tempId target dispatched before the session existed --
    // the first set of a workout. The create it was queued behind knows: it has landed by now (the
    // serial scope ran it first) and carries the session in its response. Without that, this
    // invalidates the null-keyed entry while the create's own refetch of the REAL key may already
    // hold the deleted row, and it stays on screen.
    onSettled: (_d, _e, vars) => reconcileSetChange(vars, vars.sessionId ?? landedSessionOf(client, vars.setId)),
  }));

  // Save/clear a note (blank clears it server-side). Natural idempotent upsert. A live note may
  // materialize the session, so refresh liveSession too. exerciseId resolves through the id map so a
  // note on an offline-created exercise lands on the real one.
  client.setMutationDefaults(SAVE_NOTE_MUTATION_KEY, durable({
    mutationFn: (vars) => {
      const exerciseId = requireResolvedExerciseId(client, vars.exerciseId);
      return vars.mode === 'session'
        ? saveSessionExerciseNote(vars.sessionId, exerciseId, vars.note)
        : saveLiveExerciseNote(vars.personId, { exerciseId, note: vars.note });
    },
    onSettled: (data, _e, vars) => {
      // A live note may have just materialized the session -- use the returned session id.
      const sessionId = data?.sessionId ?? vars.sessionId ?? null;
      client.invalidateQueries({ queryKey: queryKeys.sessionExerciseNote(sessionId, vars.exerciseId) });
      client.invalidateQueries({ queryKey: queryKeys.exerciseSummary(vars.personId, vars.exerciseId, sessionId) });
      refreshHistory(client, vars.personId, historyScopeFor(client, vars.personId, sessionId));
      if (vars.mode !== 'session') client.invalidateQueries({ queryKey: queryKeys.liveSession(vars.personId) });
    },
  }));

  // End the live workout. Idempotent (ending an already-ended/absent session is a no-op server-side).
  client.setMutationDefaults(END_WORKOUT_MUTATION_KEY, durable({
    mutationFn: (vars) => endWorkout(vars.personId),
    onSettled: (_d, _e, vars) => {
      client.invalidateQueries({ queryKey: queryKeys.liveSession(vars.personId) });
      refreshHistory(client, vars.personId);
    },
  }));

  // Favorite / unfavorite. Idempotent booleans; exerciseId resolves through the id map.
  client.setMutationDefaults(FAVORITE_MUTATION_KEY, durable({
    mutationFn: (vars) => {
      const exerciseId = requireResolvedExerciseId(client, vars.exerciseId);
      return vars.favorite ? favoriteExercise(vars.personId, exerciseId) : unfavoriteExercise(vars.personId, exerciseId);
    },
    onSettled: (_d, _e, vars) => {
      client.invalidateQueries({ queryKey: queryKeys.personExercises(vars.personId) });
      client.invalidateQueries({ queryKey: queryKeys.exercises() });
    },
  }));
}

registerOfflineMutationDefaults(queryClient);

// Fire a durable write against an EXPLICIT client, without a React observer. Shared by
// enqueueOutboxWrite below (the app singleton) and by any caller that already has its own
// QueryClient via context and needs the write to land in that SAME mutation cache -- e.g.
// EditSetModal.jsx dispatching an EDIT_SET write that must resolve a temp set id against whichever
// client's cache holds the matching pending `logSet` create (see setIdMap.js/offlineSetEdits.js).
export function dispatchDurableWrite(client, mutationKey, variables) {
  const observer = new MutationObserver(client, {
    ...client.getMutationDefaults(mutationKey),
    mutationKey,
  });
  // Stamps an immutable enqueueSeq the first time this write is dispatched (a no-op if variables
  // already carries one, e.g. a restore re-dispatch) -- see outboxSequence.js.
  return observer.mutate(withEnqueueSeq(variables)).catch(() => {});
}

// Fire a durable write against the app's singleton client WITHOUT a React observer -- for
// fire-and-dismiss actions (end workout) whose component has no QueryClientProvider dependency at
// all (see EndWorkoutConfirmModal.jsx, which imports the singleton directly and never calls
// useQueryClient()). The write still queues + replays via the outbox exactly like a
// useMutation-dispatched one. A component that already has `useQueryClient()` should call
// dispatchDurableWrite with its own context client instead of this -- see there for why.
export function enqueueOutboxWrite(mutationKey, variables) {
  return dispatchDurableWrite(queryClient, mutationKey, variables);
}

// Replay every queued write now: paused ones via TanStack's own `resumePausedMutations` (which
// keeps them strictly serial, in order, via the shared outbox scope), PLUS any write that's sitting
// in a terminal ERROR state (exhausted retries, or a definitive 4xx like an expired session) --
// those have nothing left to resume on their own, so they're restarted fresh from their persisted
// variables, safe because every durable write is idempotent by design. A write that's currently
// mid-retry (pending, not paused) is left alone rather than double-fired.
//
// Restarted IN PLACE (`m.execute(...)` on the existing Mutation object) rather than removed and
// re-dispatched via a new mutation -- removing and recreating always re-registers at the END of
// the shared outbox scope's array, which is what actually determines LIVE replay order (TanStack's
// scope FIFO is registration order), so it could let a write that's stuck behind a dependency
// (e.g. a log-set against a not-yet-synced exercise) jump ahead of writes genuinely submitted
// later. Reusing the same object never changes its position. This is only safe because
// `state.status === 'error'` here means the mutation's retryer already fully settled (rejected) --
// there is no live retry loop left to race against a second one; had it been 'pending' (offline or
// mid-backoff), a second `execute()` call would start a competing retryer without cancelling the
// first.
//
// The stuck list itself is sorted by `byEnqueueOrder` (outboxSequence.js's immutable, app-assigned
// `enqueueSeq`, stamped once into `variables` at first dispatch) rather than TanStack's own
// `submittedAt` -- `execute()` re-stamps `submittedAt` to "now" as part of its normal re-dispatch
// (mutation.ts's 'pending' reducer case), so keying restore/reconnect ordering off it would require
// capturing and restoring it around every re-execute, in every place that ever re-runs a mutation,
// forever. `enqueueSeq` lives in `variables`, which `execute()` never touches, so there is nothing
// to preserve here -- a later restoreOutbox restore (after a reload) sorts by the same untouched key.
//
// Called on reconnect, after the outbox is restored on boot, after a successful (re-)login, and
// from the offline banner's guarded "Go back online" button -- every one of those call sites can
// fire while there is no authenticated session (a stale/cleared token, or the moment right after a
// forced sign-out), so this is the single choke point that guarantees a queued write NEVER
// dispatches with no Authorization header. Without a token that request would 401, and a 401 can
// itself tear a session back down (see api/client.js's unauthorized handler) -- exactly the
// mechanism that turned a handful of queued offline writes into a login loop.
// It also self-gates on connectivity, for the same reason it self-gates on the token. Five call
// sites each wrote their own `if (onlineManager.isOnline()) flushOutbox()`, so every new trigger
// was a sixth copy of a precondition that belongs to the function, and any copy getting the check
// subtly wrong (or omitting it) would dispatch straight into a dead network. Flushing while
// offline is not merely wasteful: resumePausedMutations() un-pauses writes that networkMode
// deliberately parked, which is how a queued write can burn its retries against nothing.
export function flushOutbox() {
  if (!getAuthToken() || !onlineManager.isOnline()) return [];
  const resumed = queryClient.resumePausedMutations();
  const cache = queryClient.getMutationCache();
  const stuck = cache
    .getAll()
    .filter((m) => m.options.scope?.id === OUTBOX_SCOPE_ID && m.state.status === 'error')
    .sort(byEnqueueOrder);
  stuck.forEach((m) => {
    m.execute(m.state.variables).catch(() => {});
  });
  return resumed;
}

// Evicts every outbox-scoped mutation from the LIVE in-memory cache only -- does NOT touch the
// persisted IndexedDB copy under whichever account currently owns it. Used when a different
// account is about to become active and a stale write must not be able to replay under the wrong
// session (see AuthContext's adoptOutboxAccount), and by an explicit logout's full discard
// (alongside clearOutbox, which removes the IndexedDB copy too).
//
// Takes an explicit client, defaulting to the app singleton. AuthContext calls it bare (it is
// acting on the one live app client), while a caller that already holds `useQueryClient()` passes
// its own -- the same reasoning dispatchDurableWrite documents: a queued mutation lives in whichever
// client dispatched it, which in tests is a fresh per-test client rather than the singleton.
export function clearOutboxMutations(client = queryClient) {
  const cache = client.getMutationCache();
  cache
    .getAll()
    .filter((m) => m.options.scope?.id === OUTBOX_SCOPE_ID)
    .forEach((m) => cache.remove(m));
}

// IndexedDB (not localStorage) so the cache survives on iOS/PWA and is the same durable store
// offline mode will build on. idb-keyval's get/set/del are the async storage contract the
// persister expects. Guarded so that environments without IndexedDB (jsdom/unit tests, SSR) no-op
// cleanly instead of throwing -- persistence is a progressive enhancement, never a hard dependency.
const idbAvailable = typeof indexedDB !== 'undefined';
const idbStorage = {
  getItem: (key) => (idbAvailable ? get(key) : Promise.resolve(null)),
  setItem: (key, value) => (idbAvailable ? set(key, value) : Promise.resolve()),
  removeItem: (key) => (idbAvailable ? del(key) : Promise.resolve()),
};

export const queryPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: 'worktrac-query-cache',
  throttleTime: 1000,
});

// TanStack's own default (`query.state.status === 'success'`) drops a query the instant its most
// recent fetch attempt fails -- even if it's still holding perfectly good data from an earlier
// success. During lie-fi (backend unreachable, navigator.onLine still true), ordinary background
// refetches (window-focus, the offline-cache-warm cycle, a mutation's onSettled invalidation) keep
// firing and failing, so more and more queries accumulate this status while their `data` sits
// untouched in memory -- harmless on its own. But a silent forced reload (swUpdate.js's
// tryForceUpdate, which fires on an ordinary section/person switch whenever a new SW build is
// available) can land while a query is in exactly that state: hydrate() then has nothing on disk
// to restore it with, so the section boots data-less and the immediate refetch fails too (backend
// still down) -- rendering blank until real connectivity returns, even though nothing was ever
// actually lost server-side. Persisting on `data` presence instead of last-attempt status closes
// that gap.
export function shouldDehydrateQuery(query) {
  return query.state.status === 'success' || query.state.data !== undefined;
}

export const persistOptions = {
  persister: queryPersister,
  maxAge: CACHE_MAX_AGE_MS,
  buster: QUERY_CACHE_BUSTER,
  // Queries ONLY. Unsynced writes are NOT persisted here -- they live in the separate durable
  // outbox (lib/outboxPersistence.js), which has no maxAge and no buster, so ANY length of offline gap or
  // an app update (which changes the buster and discards this cache) can never drop a queued write.
  dehydrateOptions: {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery,
  },
};

// Called on every auth transition (login success + logout). The exercise catalog and tag
// vocabulary are keyed WITHOUT an accountId, so without this a second household logging in on
// the same device could read the first household's cached catalog. Clearing both the live cache
// and the persisted copy on any auth change makes cross-account bleed impossible.
//
// QUERIES only -- deliberately does not touch the mutation cache (queryClient.clear() used to,
// which is what silently wiped the durable outbox on every login/401 before this fix). The outbox
// has its own account-scoped isolation (see outboxPersistence.js's adoptOutboxAccount usage in
// AuthContext), so it doesn't need this blunt clear-everything approach to stay safe.
export function resetQueryCache() {
  queryClient.getQueryCache().clear();
  queryPersister.removeClient();
}
