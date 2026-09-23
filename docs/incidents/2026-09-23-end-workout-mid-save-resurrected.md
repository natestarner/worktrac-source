# 2026-09-23 — Ending a workout mid-save brought it back as the live one

**Area:** Offline / live session (`endedSessions.js`, `LOG_SET` onSettled, `ExerciseDetail`)
**Found by:** lower e2e, twice on one day, in two different specs whose setup logs a first set
and ends the workout straight away:
- `offline-reads.spec.ts` › *derives Last time/Best est. 1RM hard offline…* — 3/3 red on
  `e3d293e`.
- `parity-pr-celebration.spec.ts` › *a bodyweight volume record…* `[pinned-offline]` — 3/3 red on
  `016270f`, and it flaked in the other modes too.

The first was fixed in the spec (#322): it went offline before the end had synced, which is a
test bug in its own right. The second was the product bug itself.

## Symptom

End a workout within the moment its **first** set is still saving. Then start the next workout
while the connection is poor or gone. The new workout's first set shows as **"Set 2"**, under the
ended workout. The "in progress" banner shows the old workout's start time. Online it corrects
itself within a round trip or so. Degraded, it lasts until reconnect.

## Root cause

From the lower traces (the set's create took 423–446 ms):

1. The first set is in flight. The live session is the client's `{ id: null }` placeholder.
2. End is confirmed. `EndWorkoutConfirmModal` calls `markSessionEnded(personId, id)`, but there
   is **no id**, so nothing is recorded. The cache is cleared, and the end-workout is queued
   **behind** the create in the serial outbox.
3. The create lands. `LOG_SET`'s onSettled promotes `data.session` to live, because its
   `isSessionEnded` guard has nothing to match. Its invalidation refetches the live session. The
   server answers **200: still live**, because the end has not been sent yet.
4. The end is sent and lands. The refetch that would correct the cache fails, or never runs,
   once degraded.
5. The ended session is now the live one, with a real id. The next set is keyed to it
   (`contextSessionId`), and its old set is still in `sessionSets`.

The existing guard (2026-08-08) works whenever the session has an id at the tap. It had no way to
express "the session these sets are about to create is already over".

## Fix

- **`markCreatesEnded`** (`endedSessions.js`, called from `EndWorkoutConfirmModal` only when the
  session has no id). This records the tempIds of the person's pending live-set creates, which
  are exactly the ended workout's sets. It uses localStorage, so a reload can't beat it.
- **`LOG_SET` onSettled.** If the landing create was recorded (`isCreateInEndedWorkout`), mark
  its session ended **before** the promotion guard, which then skips it. `useLiveSession`
  suppresses the same id when the refetch brings it back.
- **`ExerciseDetail`'s placeholder seed** treats an ended session left in the raw cache as
  absent. Without this, `prev ?? placeholder` kept it, and because the hook hides it, the new
  workout had **no** placeholder: no banner, no dot. That is the same raw-cache-reader trap as
  2026-09-22.
- **The ended-id marker keeps the last ten ids per person**, not one. Two workouts ended offline
  replay as create, end, create, end. With a single slot, marking the second unmarked the first,
  while a live-session read from before the first end could still return it. The old single-id
  value on devices is still read (upgrade path, tested).

The tempIds are the key rather than the time of the tap. `clientLoggedAt` is the device clock,
and a correction between the tap and the next set would misfile a new workout as the ended one.

Deliberately **not** changed: `useLiveSession`'s `staleTime` rules (08-12, 09-22), the
end-workout write, the outbox, the persister, and the known-id End path.

## How it was proven

- **New parity spec** `parity-end-workout-mid-save.spec.ts`. It holds the create, the
  placeholder's live-session read, and the end, so every mode lands in the state lower hit by
  chance. It then starts the next workout in the mode. It was red in **all four modes** on the
  unfixed code with lower's exact symptom (expected 1 "Set N", got 2).
- **Each of the three app changes reverted alone** fails all four modes. The placeholder-seed
  revert fails differently: the banner is missing. That is the opposite mistake the seed change
  exists to prevent.
- **Unit tests pin every piece.** Each was run red with its guard reverted, including the
  multi-id change, the legacy single-id format, and a create restored across a reload through
  the real persist/restore round trip.

Getting the repro to measure the right thing took two tries, and both are worth knowing:

- The first-ever set always celebrates, and `dismissPrCelebration` only *checks*. The overlay
  arrived a beat later and sat over the End confirm.
- Holding the create alone let the placeholder's revalidation (`staleTime` 0 for `{ id: null }`)
  get the server's honest 204. That removed the session bar, and the End dialog with it, before it
  could be confirmed. On lower the tap landed inside that read's round trip. The spec holds the
  read to pin the same order.

## Follow-up: the fix removed a history refresh the bug had been providing

Lower's first run of the fix above was green, but `parity-pr-celebration`'s bodyweight spec needed
a retry in two modes, failing at a new line. The next workout's first set, 6 reps against a
10-rep workout, celebrated **"New PR! · Most reps · 6 reps — First time logging this one"**.

It came from the fix. On the pre-fix code, with the celebration check moved ahead of the Set count
so the old failure could not mask it, it passed in every mode (12/12). The mechanism:

- When a set lands, `LOG_SET` **invalidates** history. On the Log tab, the only history observer
  fetches **only while a workout is live** (`LogTab`'s `fetch: !!activeSessionId`).
- Before the fix, the ended workout wrongly coming back as live is what enabled that observer, so
  history refetched **by accident** and learned about the workout.
- With the fix, the workout never becomes live on the device. The invalidation reaches no observer
  that acts on it, so history never learns the ended workout existed. Degraded, "Last time" and
  the record fold are derived from history, so the next set was judged as the first ever.

**Fix:** in the same `LOG_SET` branch, **fetch** history instead of only invalidating it, using
`prefetchQuery` with the same `queryFn` as `useHistory` and `offlineCacheWarm`, and `staleTime: 0`.
The entry looks fresh from moments before the set landed, and the app's 60s default would skip it.
The unit test pins that detail using the app's staleness. It also covers the more common path: a
workout logged and ended entirely offline, whose sets land on reconnect.

A second parity spec in `parity-end-workout-mid-save.spec.ts` asserts the no-false-record claim.
It was red 3/3 in hard-offline with the fetch reverted, and green with it.

Rejected: letting the Log tab always fetch history (undoes part of 09-22 everywhere) and
`refetchQueries({ type: 'all' })` (TanStack skips a query whose only observer is disabled).

### A separate, pre-existing bug found alongside it — lie-fi and online (NOT fixed)

In **lie-fi**, the same no-false-record spec still failed with the history fetch in place. A
control with **no mid-save race at all** (an ordinary workout whose set lands long before End)
fails the same way, 3/3, and so does the code from **before either fix**.

In lie-fi, the exercise's cached summary is still being retried when Log set is tapped (it is keyed
on "no live session" and was fetched before the last workout). The record check reads that stale
summary before the fallback to history kicks in, which only happens once the retries give up.
`parity-pr-celebration`'s setup has long worked around this by re-opening the exercise online.

**Online too, on lower.** The deploy of that fix went red on the same spec in **online**, 3/3,
while it passed locally. The trace shows that the history fetch worked (it landed before the tap).
Re-opening the exercise started a summary refetch, but Log set was tapped before it returned.
Online, the record check reads the cached summary, not history, and that summary predates the
workout. Locally the refetch returns in about 5ms and wins. A control with an ordinary workout (no
race) and 800ms on the summary request fails 3/3 on the current code **and** on the code from
before either fix.

The bug is the same in both modes. The null-key summary is never refreshed when a workout ends,
and until its refetch lands, the record check trusts it over history.

It is recorded as `fixmeModes: ['lie-fi', 'online']` on the new spec, which is the reproduction.
Hard-offline and pinned-offline still guard the history fix. It is not sanctioned: it belongs
fixed or on `resilience.md`'s register, and that decision is open.

## Takeaways

- **"Ended" needs a name for the thing that was ended, even before the server has named it.** An
  id-only marker silently does nothing for the placeholder. That covers every workout ended
  offline, plus any ended in the moment its first set is saving.
- **Every raw reader of a suppressed cache entry is a second place the bug can live** (again —
  09-22 said this). The hook hid the ended session; the placeholder seed still kept it.
- **Removing a bug can remove what it was doing by accident.** The ended workout coming back was
  also what refreshed history. When a fix stops something happening, list what that something
  triggered. The same lesson as 09-22, from the other side.
- **A spec whose setup does "log first set, End" is a probe for this race.** It hit lower from two
  unrelated specs in one day, which is what finally made it visible.
