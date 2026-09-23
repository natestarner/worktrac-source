# 2026-09-22 — A restored "no live session" hid the workout that had just started

**Area:** Offline / persistence (`useLiveSession`)
**Found by:** `offline-active-loop.spec.ts` › *editing then deleting a not-yet-synced set leaves
nothing stuck, and later writes still sync*, while shipping an unrelated change
(`LogTab`'s history read). The spec failed 3 of 8 runs with that change and 0 of 8 without it.

## Symptom

Log the first set of a workout online, reload within about a second, and the set shows under
"Last time · Today" instead of "This session". There are no Edit/Delete controls on it, and nothing
corrects it: the live session isn't refetched.

The everyday trigger is not a manual reload. `swUpdate.js` silently reloads on ordinary navigation
whenever a new build exists, which is **always just after a deploy**.

## Root cause

The query persister writes at most once a second. Logging the first set turns the person's
`liveSession` entry from `null` (the server's 204, "no live session") into a real session. A reload
inside that second restores the **pre-log `null`** — with a `dataUpdatedAt` from moments earlier.

`useLiveSession`'s `staleTime` function treated that as fresh for 10s. So after the reload no
`GET /sessions/live` was sent (the Playwright trace shows none), `contextSessionId` stayed null, the
summary was fetched with no `excludeSessionId`, and today's set was presented as the last session.

This is the sibling of `2026-08-12-provisional-live-session-restored-as-fresh.md`. That fix made the
client-invented `{ id: null }` placeholder never count as fresh. It did not cover `null`, a
genuine server answer that went stale inside the persist window.

## Why it surfaced now

The race existed on `main`; it lost it less often there. `LogTab` used to read history under a
`null` key until a session existed, so the moment the session arrived it **added** an observer to
the person's history query. That query-cache event happened to kick the throttled persister at a
useful moment. Reading the person's history cache all along (the change being shipped) removed the
event, and the reload started landing inside the window. Nothing about the new code was wrong;
it removed an accident the spec had been relying on.

## Fix

`staleTime` is now `0` for `null` as well as for `{ id: null }`. Revalidating a restored null
costs one 204.

It cannot resurrect a workout this device ended — `EndWorkoutConfirmModal` also writes `null`, and
until the end syncs the server still reports the session as live — because `isSessionEnded`
suppresses that id whatever the refetch returns. `useLiveSession.test.jsx` pins both halves through
the app's real `persistOptions` round trip; both tests fail against the old `staleTime`.

After the fix the spec passed 16 of 16.

## Takeaway

**A throttled persister means any cache entry can be restored from up to a second ago.** For an
entry whose staleness decides what the screen treats as *current* — the live session above all —
"recently fetched" is not evidence of "still true". Ask of every such entry what a copy from a
second ago would make the app believe, not just what a copy from an hour ago would.

And, from how it was found: **when unrelated code makes a spec flaky, bisect before blaming the
flake, then read the trace before blaming the code.** The bisect showed the change was involved;
the trace showed it was only the trigger.
