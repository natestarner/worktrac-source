# 2026-08-14 — A routine's position was lost when a reload beat the IndexedDB commit

**Symptom.** Advance a routine to its second exercise, reload, and the app comes back on the
routine but at the *first* exercise. The routine itself survives; only the position resets.

**Where it showed up.** `reload-persistence.spec.ts` › "an active routine survives a page reload,
resuming at the same position", against **lower**. It was the single worst test in the suite:
flaky in 33 of 51 runs and an outright failure in 5 more — 38 of 51 — while local runs passed
essentially always. Nobody noticed for weeks because CI retries turned every one of those into a
green check (see `2026-08-13-e2e-parallel-flakiness.md` for the sibling problem of *reading* those
greens).

## Root cause

Per-person UI state (active routine and position, tab, drafts) lived in IndexedDB via
`idb-keyval`. `AppStateContext` wrote it from an effect on every dispatch:

```js
saveAppState(accountId, snapshot);   // async: resolves a transaction on a later task
```

`page.reload()` in the spec is issued the moment "2 of 2" paints. From the failing run's trace:

```
5.48s  click "Dumbbell Overhead Press"
5.53s  expect  ("2 of 2" visible — resolves)
5.53s  page.reload()          ← same millisecond
```

So the document is torn down within a few milliseconds of the state change. Measured on an idle
dev machine, the IndexedDB commit landed ~3ms after the position painted — fast enough to win
locally, and not always fast enough on lower's shared runner. When it lost, the *previous* write
(START_ROUTINE, index 0) was already committed and the new one was not, which is exactly the
observed symptom: routine present, position reset.

**The previous code knew about this race and believed it had closed it.** Its comment said writing
immediately rather than debouncing "is what actually closes the race", having found that
`pagehide`/`visibilitychange` flushes couldn't finish an in-flight write. Firing earlier *narrows*
the window; it cannot close it. An unload handler cannot await, so **no amount of scheduling makes
an async store durable at teardown.**

## What made it a real bug, not a clunky test

The spec reloads immediately, which looks artificial until you ask who else reloads:

- `swUpdate.js`'s `tryForceUpdate` force-reloads on ordinary navigation whenever a new build
  exists — i.e. **always just after a deploy**, at an instant the person did not choose.
- A person tapping to the next exercise and then pulling to refresh, or iOS evicting the tab.

This is the same failure family as
`2026-08-08-ended-workout-resurrected-by-persisted-cache.md`, where a silent service-worker reload
beat a throttled persist. That one shipped to production. This one was caught by a test that was
being dismissed as flaky.

## The fix

`appStatePersistence.js` now stores the snapshot in **localStorage**, whose `setItem` is
synchronous: once it returns, a subsequent document load reads the new value. The race is removed
rather than narrowed. The payload is a few KB of JSON-serializable UI state, and `authSnapshot.js`
already stores identity there for the same synchronous-access reason — so this is an existing
pattern, not a new mechanism.

`loadAppState` reads localStorage first and falls back once to the legacy IndexedDB key, adopting
that snapshot and rewriting it forward. It only deletes the legacy copy after the new write is
confirmed, so a failing localStorage degrades to "keeps reading the old store" rather than losing
state. Without that path every existing install would have silently dropped an in-progress routine
exactly once on upgrade.

The `pagehide`/`visibilitychange` flush in `AppStateContext` is gone: it existed solely to chase an
in-flight async write, and there is no longer one to chase.

## Takeaway

**If state has to survive a teardown you do not control, the write must be synchronous.** Ask of
any persisted state: *if the document died the instant after this changed, would the change be
there?* For IndexedDB the answer is "probably, if nothing else was happening" — which is not a
guarantee, and degrades exactly when the machine is busy.

Choose the store by durability requirement, not by size habit:

| State | Store | Why |
|---|---|---|
| In-progress UI state, auth snapshot, token | localStorage | Must be durable at an uncontrolled teardown; small and JSON-serializable |
| Query cache, durable outbox | IndexedDB | Large and/or structured-clone; already tolerates loss by design (the outbox replays, the cache refetches) |

Note the query cache lives with a 1s persister throttle and is *fine* with it, because losing a
cached read costs a refetch. Losing a queued write or a routine position costs the person's work.
