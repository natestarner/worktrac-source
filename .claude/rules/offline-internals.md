---
paths:
  - "frontend/src/lib/**"
  - "frontend/src/hooks/**"
  - "frontend/src/api/**"
---

# Offline machinery internals

The mechanism behind the rules in `frontend-core.md`. Full narrative:
`docs/architecture/offline-mode.md`. Several of these were expensive to find — check
`docs/incidents/` before changing any of them.

## Three connectivity states, not two

1. **Online.**
2. **Lie-fi** — backend unreachable/erroring while `navigator.onLine` still reports `true`.
   Detected in `reachabilityMonitor.js`: every request outcome in `api/client.js` feeds a
   consecutive-failure counter; a real completed response (**even a 4xx/5xx — the server
   answered**) resets it to zero, only a genuine rejected fetch counts. 3 in a row ⇒
   `ConnectionTroubleBanner` suggests "Go offline".
3. **Offline** — auto hard-offline, or a user-elected manual pin.

`useOnlineStatus` reads TanStack's `onlineManager` and is the single source of truth every other
piece of offline UI/gating reads. It reflects hard offline or the manual pin — **never lie-fi**.

The manual pin (`offlineMode.js`) is device-global, re-applied at module load so it survives
reload. It is **only ever exited by the user**, and only after `probeReachability()` succeeds —
never auto-unpins on its own, even if the connection flickers back.

## Ordering: use `enqueueSeq`, never `submittedAt`

**Rule for any ordering or "pick latest" logic over queued mutations: key off an immutable,
app-assigned value (`enqueueSeq`, `clientLoggedAt`), never TanStack's own `submittedAt`.**

`submittedAt` is a framework timestamp **re-stamped to "now" on every re-execute**. Keying off it
made queued writes drift out of order on reload, and on a second reload sort *actually* wrong —
re-deadlocking the whole outbox. `enqueueSeq` (`outboxSequence.js`) is stamped once into a durable
write's own `variables` at first dispatch (`dispatchDurableWrite` / `useDurableMutation`) and never
touched again. `restoreOutbox`, `flushOutbox`, and `useOutboxItems` all sort by it (`byEnqueueOrder`).
See `docs/incidents/2026-08-01-outbox-reorder-enqueueseq.md`.

## The durable outbox

- Every offline-capable write shares one mutation scope (`OUTBOX_SCOPE_ID`) so queued writes
  replay **strictly serially, in enqueue order**. TanStack enforces *registration order into the
  scope's array*, not submit time — so `restoreOutbox` must merge paused and not-paused writes
  into **one** sorted pass before registering anything. Splitting into two batches is what caused
  `docs/incidents/2026-07-29-outbox-replay-order-deadlock.md`.
- `flushOutbox`'s stuck retry restarts the same `Mutation` object in place (`m.execute(...)`)
  instead of remove-and-recreate (which always re-registers at the end of the array). Safe only
  because a terminal-`'error'` mutation's retryer has fully settled, unlike a `'pending'` one.
- Persisted to its **own** IndexedDB key (`worktrac-outbox:<accountId>`), deliberately separate
  from the query cache's persister, so neither the 24h `maxAge` nor an app-update `buster` bump
  can silently drop a queued write.
- **Retries forever on transient failure** (`shouldRetryWrite`): 5xx, timeout, or statusless
  network error backs off (capped 30s) but never gives up. Only a definitive **4xx** stops
  retrying, since a write that can never succeed would head-of-line-block the shared serial scope.
- A dependent write resolving to an unmapped temp id throws a **status-less (therefore retryable)**
  error rather than dispatching a value the backend can't parse (`requireResolvedExerciseId` /
  `requireResolvedSetId`, via `exerciseIdMap.js` / `setIdMap.js`). Delete-set treats a replay 404
  as success.
- **Gated on an authenticated session:** `flushOutbox`/`restoreOutbox` no-op or hydrate as paused
  when there's no token, rather than firing a write with no `Authorization` header — that 401
  could tear down a session that a moment later *does* have a valid token.

## Editing a still-queued set

An edit is a genuinely separate, durable `EDIT_SET` write targeting the create's `tempId`, never a
mutation or re-dispatch of the create. There is **no public API to cancel an in-flight mutation's
retry loop**, and `Mutation.execute(newVars)` on a `'pending'` mutation skips the
`state.variables` update — in-place editing was never viable. Two accepted UX costs (a brief
revert-then-correct flicker; PR celebration reflecting the pre-edit value) are deliberate and
documented in `docs/incidents/2026-07-30-editing-queued-offline-set.md` — don't "fix" them into
connectivity-mode special-casing.

## Subscribing to the MutationCache: always `notifyManager.schedule`

Three hooks read queued writes straight off the MutationCache via `useSyncExternalStore` —
`useSessionEntries`, `useOutboxItems`, `useOutboxCount`. **Their `subscribe` callback must hand
`onChange` to `notifyManager.schedule(...)`, never call it inline.**

The cache emits *synchronously* from inside `notifyManager.batch`. A descendant of the subscribing
component can cause an emit during **its own** render (mounting a durable-write observer), which
lands mid-render for the subscriber — so an inline `onChange()` schedules a React update on a
component while a child is rendering, and React logs `Cannot update a component (LogTab) while
rendering a different component`. It recovers with an extra pass, but this is the same machinery
that produced an infinite-render loop before (hence the `dirty`-flag referential-stability guards
in `useSessionEntries`/`useOutboxItems` — keep those too).

`notifyManager.schedule` is exactly what TanStack's own `useMutationState` does for this job, so
batching and test-mode flushing (`notifyManager.setScheduler`) stay consistent with the library —
don't substitute a bare `queueMicrotask`/`setTimeout` or a `useEffect` hop.

Each of the three has a regression test that reproduces the warning by mounting a child **after**
the subscription is live (on a first render nothing is subscribed yet, so the bug cannot show —
a test that mounts parent and child together passes either way and guards nothing).

There is a **fourth** MutationCache subscriber: `LogTab.jsx`'s effect that migrates the selected
exercise from a temp id to the real one once a `createExercise` write syncs. It calls
`selectExercise` (a state setter) straight from the notification. It has not been observed causing
the warning — a create-success notification comes from a network response, not from a render — so
it was deliberately left alone rather than changed speculatively. **If the warning ever names
`LogTab` again after the three hooks above were fixed, this is where to look.**

## Query cache persistence

`shouldDehydrateQuery` (`queryClient.js`) persists a query whenever it holds usable `data`,
**regardless of its last fetch attempt's status**. TanStack's default (`status === 'success'`)
dropped queries the instant a background refetch failed, which during lie-fi + `swUpdate.js`'s
silent forced reload made cached sections boot data-less. See
`docs/incidents/2026-07-28-liefi-cached-sections-blank.md`. The cache is cleared on every auth
change (`resetQueryCache`).

## The persisted cache can resurrect an ended workout

The persister's write is **throttled** (persistQueryClient's 1s default; `persistOptions` sets no
`throttleTime`), and `swUpdate.js`'s `tryForceUpdate` silently reloads on ordinary navigation
whenever a new SW build is available — **always true just after a deploy**. A reload landing inside
that window boots from a snapshot taken *before* the most recent cache change.

For `liveSession` that is not merely stale. Its id feeds `ExerciseDetail`'s `contextSessionId`,
which gates `sessionSets` — and a restored session carries a **real** id, unlike the deliberate
`{ id: null }` offline placeholder `contextSessionId` is built to ignore. So a finished workout is
treated as live and its still-cached sets render under "This session". Online the 10s `staleTime`
corrects it on the next refetch; **offline nothing can**, so it stands for the whole stretch.

`endedSessions.js` closes this with a **synchronous localStorage marker** written before the cache
clear (`EndWorkoutConfirmModal`), which `useLiveSession` consults. localStorage specifically
because the write cannot be beaten by a reload — the same reasoning as `offlineMode.js`'s manual
pin and `outboxPersistence.js`'s account pointer. The marker is never cleared and needs no
clearing: it suppresses exactly one id, and session ids are never reused.

**Any other cache entry whose staleness would be actively wrong rather than merely old needs the
same treatment** — a throttled persist plus a reload you can't predict means the query cache alone
can't be trusted to carry "this thing is over".

## Cache warming

`offlineCacheWarm.js` prefetches **every** household member's logging essentials, not just the
active person — a device hand-off mid-outage must still render. Deliberately excludes
`trendsOverview`/`exerciseTrend` (high-cost analytics fan-out) and `ExerciseDetail`'s
session-scoped queries (can't be enumerated without a session id). `exerciseSummary` is instead
derived client-side from the warmed `history` cache (`utils/exerciseSummaryFromHistory.js`), and
once stuck is preferred **over** `summaryQuery.data`, not just used when data is absent.

### A restored entry is "fresh" without being correct — the boot warm must override that

A rehydrated entry keeps the `dataUpdatedAt` it had when persisted, so it satisfies both the warm's
30s staleness check and the queries' own 60s `staleTime`. But the persister is **throttled at 1s**,
so anything changed in the last second before a reload was never written — and nothing then
refetches it until the **5-minute** warm tick. A routine created seconds before a reload therefore
vanished from the Routines tab for minutes (issue #146, seen as a lower e2e failure in
`reload-persistence.spec.ts`).

The boot warm — the one `useOfflineCacheWarming` fires once `isRestoring` clears — passes
`{ afterRestore: true }`, which drops `staleTime` to 0 **for keys marked `refreshAfterRestore`**.
Later warms (online transition, visibility, interval) deliberately don't: by then the cache is
what this page session fetched, and ordinary staleness is right.

**`refreshAfterRestore` is opt-in per key, and must stay that way.** It is only safe for
collections the server wholly owns:

| Key | Forced? | Why |
|---|---|---|
| `routines` | ✅ | routine CRUD is online-gated, so the cache can't hold an unsent routine |
| `history`, `prs` | ✅ | no optimistic writer; invalidation-driven only |
| `exercises`, `personExercises` | ❌ | `insertOptimisticExercise` holds a **temp exercise** here while its create is still queued — refetching deletes it from the picker mid-flight |
| `liveSession` | ❌ | `EndWorkoutConfirmModal` optimistically nulls it on end-workout |

**Before marking any new key, ask: can this key ever hold state that hasn't reached the server?**
If yes, forcing a refetch destroys it. That trade is the whole reason this is a per-key list and
not a blanket "invalidate everything after hydrate".

### A value the CLIENT invented has no honest `dataUpdatedAt` at all

Stronger than the case above, and it needs the opposite fix. `setQueryData` stamps
`dataUpdatedAt = Date.now()` whether the value came from the server or from us — so an optimistic
placeholder is persisted looking exactly like a fresh fetch, and after a reload it satisfies **every**
staleness check in the app (the query's own, the global 60s, the warm's 30s). It is not stale; it was
never true.

`logSetMutation.onMutate`'s provisional `{ id: null }` liveSession is the live example. Restored, it
kept `contextSessionId` null forever, so `sessionSets` never ran and a synced set was missing from
"This session" (`docs/incidents/2026-08-12-provisional-live-session-restored-as-fresh.md`).
`useLiveSession` closes it with a **per-query** `staleTime` function — a session with no server id can
never be fresh — so the entry still renders while offline (the refetch merely pauses) but is
revalidated the moment there is a network.

**Any new optimistic `setQueryData` that writes a value the server has never confirmed needs one of
these three**, and which one depends on what a restored copy would be:
| Restored copy is… | Treatment | Example |
|---|---|---|
| merely out of date | `refreshAfterRestore` | `routines` |
| actively wrong | a synchronous localStorage marker beside the cache | `endedSessions.js` |
| **never true at all** | never let it count as fresh (`staleTime` 0 for that shape) | the provisional liveSession |

## Cold boot offline

`AuthContext` boots authenticated-but-`offline:true` from a saved identity snapshot when `/me`
fails with a network error or 5xx and a token + snapshot exist; a real **401 still bounces to
`/login`**. With **no snapshot yet**, a transient `/me` failure holds the loading skeleton and
retries with capped doubling backoff instead of signing out. Requires the production service
worker to precache the app shell — **disabled in `vite dev`** and Vitest.
