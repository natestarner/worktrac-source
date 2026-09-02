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
  from the query cache's persister, so neither the query cache's `maxAge` nor an app-update `buster` bump
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

## Cache lifetime: 14 days, and the ceiling is `setTimeout`, not taste

`maxAge`/`gcTime` are 14 days. They move together — a `gcTime` below `maxAge` garbage-collects
persisted entries out of memory before a restore can bring them back.

- **A short `maxAge` empties the cache from exactly the person who needs it.** It was 24h, and the
  person most likely to need the offline copy is the one who has not opened the app in a while,
  whose backend has therefore scaled to zero. Measured at 25h with a cold backend: the app boots
  with every section blank for the full 15s abort and beyond.
- **Never set either above 2³¹−1 ms (~24.85 days).** TanStack schedules GC with
  `setTimeout(..., gcTime)`; past that the 32-bit timer overflows and fires ~immediately, so a
  *longer* `gcTime` evicts every inactive query within a millisecond and empties what the persister
  then writes. Node warns (`TimeoutOverflowWarning`); browsers are silent.
  `queryClient.test.js` pins it against `MAX_SAFE_TIMEOUT_MS`.
- **Age is not staleness.** A longer `maxAge` is not a longer `staleTime`: restored entries are
  still revalidated at 60s the moment there is a network, `refreshAfterRestore` still force-refreshes
  its keys on every boot, and `OfflineDataNotice` still shows how old the data is.

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

### A DESTRUCTIVE decision from a query gates on `isFetchedAfterMount`, never `dataUpdatedAt`

`dataUpdatedAt` **survives the persist/hydrate round trip**, so a restored entry reports itself
freshly fetched — it cannot distinguish "the server told us this" from "this came off disk".
`isFetchedAfterMount` can: TanStack derives it from the fetch count against the observer's own
initial snapshot, so hydrated data reads `false` until the network actually confirms it.

`LogTab`'s "end a routine that no longer exists" gate read `dataUpdatedAt` and carried a comment
claiming it "stays 0/falsy until a REAL fetch has completed". It doesn't, and the gate only held
because `AppShell` (and `useOfflineCacheWarming`'s boot warm) happened to mount a frame before
`LogTab`, so `isFetching` was already true — an accident of render ordering that disappeared the
moment `ProtectedRoute`'s gate was tightened. It was also wrong offline in its own right: a
**paused** query reports `isFetching: false` while holding restored data, so it would destroy state
on evidence it could not revalidate. See
`docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md`.

**Not acting is the correct degradation** for anything of this shape — the next confirmed fetch
reconciles it.

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

#### The same rule, outside the warm: never AWAIT an invalidation of a key holding an optimistic row

`refreshAfterRestore` is one way to destroy an unsent optimistic row; a plain
`await invalidateQueries(...)` at a call site is another, and the table above does not stop it.
`LogTab.handleExerciseCreated` awaited a refetch of `exercises` + `personExercises` and *then*
selected the exercise `insertOptimisticExercise` had just written into those very keys — so online
the row was evicted milliseconds before it was named, and the person landed back on the picker.

- **Read the optimistic row first, refetch never.** The write's own `onSettled` already invalidates
  the keys it touched, at the only moment a refetch can return the real row. A second invalidation
  at the call site is redundant *and* racing it.
- **This is also how a bug hides in all three degraded modes.** `invalidateQueries` on a *paused*
  query resolves immediately without fetching, and a lie-fi refetch fails while keeping its `data`
  — so the eviction only happens when the network actually answers. Offline "working" is not
  evidence; it can mean the request that breaks things never ran.
- **Selection restored from an earlier world needs a catch-up, not just a subscription.** LogTab's
  MutationCache subscriber only sees mappings recorded from the moment it subscribes, so it also
  resolves through `resolveExerciseId` *before* subscribing — a create that synced while the
  component was unmounted (another tab, during boot) otherwise leaves a temp id selected forever.

- **An optimistic write may PATCH a query entry; it must never BUILD one.** `setQueryData` calls
  `queryCache.build()`, so writing to a key with no entry *creates* it -- holding whatever that one
  updater returned, stamped `dataUpdatedAt = Date.now()`. A create replayed from the outbox has no
  component behind it and the cache it was queued against may be gone (cleared on an auth change,
  or dropped by the `maxAge` / `buster` the outbox deliberately does not share), so this is a
  reachable state, not a hypothetical. The result is a catalog whose only member is that one
  exercise: online the following invalidation repairs it in a round trip, but a replay can land on
  any tab, and with no observer to refetch -- or offline before it lands -- that stands as the
  person's entire library. **Return `undefined` from the updater when `rows === undefined`**;
  TanStack then skips the write entirely. Applies to `CREATE_EXERCISE`'s `onSettled` and to
  `AddEditExerciseModal`'s open-an-existing-exercise favorite alike.
- **Reaching the screen sooner means the temp->real swap now happens WHILE someone is using it, so
  the swap must reconcile from the response.** `CREATE_EXERCISE`'s `onSettled` replaces the
  optimistic row with the server's row in both keys *before* invalidating. Invalidating alone only
  marks them stale: the real row lands a round trip later, and LogTab's selection has already moved
  to the real id -- so for that whole window neither id is in either list, `selectedExercise` is
  `null`, and `ExerciseDetail` unmounts back to the picker. It ate the first tap on a just-created
  timed exercise's Time field. Same rule, and the same `data`-is-defined inertness argument, as
  `LOG_SET`'s reconciliation. Keep the per-person overlay (`isFavorite`/`tags`) when swapping --
  `ExerciseDto` doesn't carry it, and a blind overwrite drops the exercise out of the picker for the
  same round trip.

`docs/incidents/2026-08-19-exercise-create-navigation-lost-online.md`; guarded by
`parity-exercise-create.spec.ts` (all four modes) and `LogTab.test.jsx`'s never-settling refetch.

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

### Signing in must be atomic: acquire, THEN discard

`verifyNewSession()` is the one choke point for `login()` and `confirmEmail()`. It sets the token,
awaits `/me`, and only then discards the previous household's snapshot and query cache — and on
any non-4xx failure it **puts the previous token back**.

Getting this backwards is the root cause of the 2026-09-02 white screen
(`docs/incidents/2026-09-02-cold-backend-login-strands-the-device.md`). The old order tore
everything down first, so a `/me` that timed out left a **valid token, no snapshot, no persisted
cache** — a combination the boot effect above can only read as "retry forever", producing a boot
skeleton with no exit that a reload reconstructs every time.

- **`resetQueryCache()`/`clearAuthSnapshot()` must never run before the replacement is in hand.**
  They are still required — account-shared keys (catalog, tags) carry no accountId — but a sign-in
  that never completed must not cost the CURRENT session its offline copy.
- **Don't restore the token on a definitive 4xx.** `api/client.js` has already cleared it and run
  the unauthorized handler; putting it back resurrects a session the server just rejected.
- **The boot retry is unbounded on purpose, but its VISIBILITY is not.** After
  `BOOT_STALL_AFTER_ATTEMPTS` unreachable attempts with no snapshot, `bootStalled` lets
  `ProtectedRoute` show a real way out while the retry keeps running underneath and heals the
  screen by itself. Three attempts, because lower's ~35s cold start against a 15s client abort
  makes attempts 1–2 failing the *ordinary* path, not a fault.
