# 2026-09-24 — Trends ignored the set logged just before it opened

## Symptom

Four lower e2e specs needed a retry, intermittently, since at least 2026-09-23. Each one failed its
first attempt and passed on retry:

| Spec | Waited for |
|---|---|
| `endurance.spec.ts` › history and the records table read a hold as time | "Records · holds" |
| `trends.spec.ts` › a bodyweight-only lift gets a rep-based records view | "Records · bodyweight" |
| `trends.spec.ts` › a bodyweight-only lift hides the weight-based chart metrics too | the "Est. 1RM" metric button |
| `trends.spec.ts` › heatmap, metric switchers and records table all render real data | "3 sets across 1 workout" |

All four log a set (or three) and go **straight to the Trends tab**. Lower's page snapshots of the
failing attempts showed what Trends was actually rendering after 24 seconds:

- "**No workouts logged yet**" — with a workout in progress and a rest timer reading **0:23**, so
  the set had been logged 23 seconds earlier.
- The heatmap cell reading "**2 sets across 1 workout**" after three sets, with 30-day volume
  **1575 lb** — exactly 135×10 + 225×1, the first two.

So the Trends overview held data from **before the last set**, and never refetched.

## What it was not

- **Not a missing invalidation.** `LOG_SET`'s `onSettled` calls `invalidateTrends`, which covers all
  three trends prefixes (overview, exercise trend, records).
- **Not server-side caching.** There is no caching of stats in the backend.
- **Not reproducible with uniform latency.** Delaying every API call 750ms (the recipe that
  reproduced this week's other lower-only flakes) passed 16/16. That delay holds each request
  *before it is sent*, so the server always saw the set before the overview request — the wrong
  ordering for this bug.

## Root cause

TanStack Query v5's `Query#fetch` (query-core 5.102.8, `query.js`):

```js
if (this.state.fetchStatus !== "idle" && this.#retryer?.status() !== "rejected") {
  if (this.state.data !== void 0 && fetchOptions?.cancelRefetch) this.cancel({ silent: true });
  else if (this.#retryer) { this.#retryer.continueRetry(); return this.#retryer.promise; }
}
```

A refetch cancels an in-flight fetch **only when the query already has data**. During a **first
load** it returns the in-flight promise — it joins the request already running.

Trends is the one tab `offlineCacheWarm` deliberately does not warm (a costly per-person fan-out), so
opening it is always a first load. The sequence:

1. A set is logged; its create takes ~1s on lower.
2. Trends opens. Its overview's first load reaches the server **before the set is committed**.
3. The create lands. `invalidateTrends` refetches the (active) overview — which **joins** the
   in-flight first load instead of replacing it.
4. The first load's answer, computed before the set existed, arrives. A successful fetch resets
   `isInvalidated` and stamps `dataUpdatedAt = now`, so the stale answer is now **fresh**.
5. It stands for the full 60s `staleTime`: "No workouts logged yet" mid-workout.

A real user hits the same thing: log a set on a slow gym connection and open Trends before the save
finishes, on the first Trends visit of the session.

## Reproduction

Pinning the order rather than the latency: the overview request is allowed to reach the server
immediately but its **response is held**, while the set's create is held before sending and
released mid-load. Three of the four specs then failed 9/9 with lower's exact messages; with the fix
(as a probe) 12/12 passed. `e2e/tests/trends-first-load.spec.ts` pins the same order
deterministically with `holdNetwork` and a response hold: 3/3 red before the fix, 8/8 green after.

## Fix

`invalidateTrends` **cancels, then invalidates**. Cancelling a first load reverts the query to
"no data yet", so the invalidation starts a genuinely new request. With data cached it changes
nothing (the refetch cancels there anyway); with nothing in flight the cancel is a no-op; a paused
fetch is cancelled and paused again. One code path in every mode.

It is **confined to the trends keys on purpose.** A cancel reverts the query to its state from before
the fetch began, and `LOG_SET` writes seeds into `sessionSets` / `exerciseSummary` *during* in-flight
fetches — cancel-then-invalidate there would throw those seeds away. Nothing writes into a trends
key, which is what makes it safe here.

The invalidation now runs one microtask after the write settles (when the cancel resolves), so the
existing "marks every cached trends range stale" unit test reads it with `vi.waitFor`. Its assertion
is unchanged.

## Takeaways

- **An invalidation is not a refetch guarantee.** During a first load it is silently absorbed by the
  request already running. Any unwarmed read that a write can race needs cancel-then-invalidate —
  but only where nothing writes into the key mid-fetch. Recorded in `frontend-core.md`.
- **Latency is not ordering.** A uniform delay reproduced three other flakes this week and could not
  reproduce this one, because this one needs the server to answer *before* the write lands and the
  client to receive that answer *after*. When a repro won't come, ask which ordering the failure
  needs, and pin that.
- **The failing attempt's page snapshot answered what no trace could.** Every failure here was a
  first attempt, and traces are recorded only on the first retry — but lower saves an
  `error-context` snapshot for every failure, and "No workouts logged yet" beside a 0:23 rest timer
  ruled out three hypotheses at once.
