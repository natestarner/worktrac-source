# 2026-11-02 — A late "no live workout" answer split a workout in offline mode

## Symptom

On lower deploy run 41450852695, `parity-session-recap`'s "ending a workout reports what was logged [pinned-offline]" (@critical) failed once and passed on retry. It had not failed in the previous 14 lower deploys.

- **The reported error** was a 90s timeout clicking "Go back online", because something intercepted the click.
- **The failure screenshot** showed something else. The End dialog read **2 exercises · 2 sets**, while the offline banner said **3 changes waiting to sync**. Three sets had been logged.

## Why it took a moment to find

- **The reported error was not the failure.**
  - `forEachConnectivityMode` restored connectivity in a `finally`.
  - Pinned-offline leaves through the banner's "Go back online", and the still-open End dialog covered that button.
  - So the restore hung until the test timeout, and its error replaced the assertion that had actually failed.
- **There was no trace for the failed attempt.** Traces are recorded on the first retry only, and the retry passed, so only the screenshot was left.
- **It never reproduced locally.** The spec ran 40 of 40 green across all four modes, because local round trips are too fast for the race.

## Root cause

When the first set of a workout is logged with no session yet, `ExerciseDetail`'s log-set `onMutate` seeds a placeholder live session, `{ id: null, startedAt: <the set's clientLoggedAt> }`. That placeholder is what lights up the session bar and End workout before anything has synced.

The server cannot know about that workout until one of its sets lands, so until then its honest answer to `GET /sessions/live` is "none", and that answer **replaced the placeholder**.

Pinned-offline is where the replacement sticks, because the network still works there. The failing sequence:

1. A live-session fetch is already on the wire when offline mode is switched on. It is usually the boot or warm-up fetch.
2. The person logs their first set, which seeds the placeholder.
3. The fetch lands with "none". The placeholder is gone and the session bar disappears.
4. The next set seeds a **new** placeholder, stamped with its own, later time.
5. `useSessionRecap` counts sets with `clientLoggedAt >= startedAt`, so it drops every set logged before step 4.

Online the same overwrite happened for one create round trip. `offline-internals.md` recorded that since 2026-09-23 as an accepted cost: the End dialog, opened mid-save, closed itself again.

**Nothing was lost on the server.** With the race held open locally, it stored one ended workout holding all three sets. What went wrong was:
- the End dialog's and the toast's counts and duration;
- the session's start time;
- the session bar and End workout disappearing until the next set.

## Fix

`lib/liveSession.js#fetchLiveSession` is now the one fetcher of `queryKeys.liveSession`; before, `useLiveSession` and `offlineCacheWarm` each fetched it inline. A fetched `null` keeps the placeholder while this person has a live-set create that has not synced and is not part of a workout they already ended (`markCreatesEnded`). Every other answer is taken as it was before.

`pendingLiveSetCreates` moved out of `EndWorkoutConfirmModal` into `queryClient.js` unchanged, so the End tap and the fetcher read the same set of creates.

**Considered and rejected:** cancelling an in-flight live-session fetch when seeding the placeholder. It is a one-line change, and it fixes this sequence. But after a reload mid-workout, that in-flight fetch may be the one bringing back the **real** session. In offline mode, cancelling it would leave `contextSessionId` null and the workout's synced sets missing from "This session" for the whole stretch. That is the 2026-09-22 bug in a new place.

**The harness:** `forEachConnectivityMode` no longer restores in a `finally`. A failure ends the test and its browser context, so there is nothing to restore. Verified with a deliberately wrong count: before the change it was reported as the click timeout, after it as the assertion.

## Guards

- **`parity-session-recap.spec.ts`, "late live-session answer".** It holds the live-session fetch, logs a set, releases the fetch, then logs two more and ends the workout.
  - On the old code it is red 3/3. The session-bar check and the recap check each fail on their own.
  - It ends with the History convergence check.
- **`lib/liveSession.test.js`.**
  - It covers both directions: keeps the placeholder, clears it, real session wins, a `null` stays `null`, ended workouts, another person, past-workout sets, a refused set, and a failed fetch.
  - Every "keeps" case was verified red with the guard removed.
  - Every "clears" case was verified red with the guard broadened.
- **`useLiveSession.test.jsx` and `offlineCacheWarm.test.js`.** These cover the same rule through each real caller. The hook tests first wait for the placeholder to be on screen: while a fetch is pending the hook already reads `null`, so without that wait the "clears" case passed vacuously.

## Takeaway

- **A value the client invented must not be overwritten by a server answer that predates it.** A refetch answers the question as it stood when it was asked.
- **When a test fails in its cleanup, the cleanup's error is not the failure.** Read the screenshot first.
