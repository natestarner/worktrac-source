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

## Fix — and the first fix, which was wrong

**First attempt (shipped in #314, reverted here):** `staleTime` 0 for *every* `null`. It fixed the
spec and broke lower, where the next workout inherited the ended one's sets ("Set 2" on a first
set). `EndWorkoutConfirmModal` writes `null` too. Revalidating *that* immediately fetched the
session back while the end was still on its way to the server — into the **raw cache**, where
`ExerciseDetail`'s `prev ?? provisional` then kept it. The reasoning that `isSessionEnded` covers
this was wrong: it filters the hook's return value, not what other code reads from the cache.

**Actual fix:** `staleTime` is 0 only for a `null` **restored from disk**, recognised by a
`dataUpdatedAt` older than this document (`PAGE_LOADED_AT`). Anything written or fetched during the
page is newer, so End Workout's `null` keeps the old 10s trust, exactly as before. Revalidating a
restored null costs one 204.

`useLiveSession.test.jsx` pins both halves through the app's real `persistOptions` round trip: a
restored null is refetched (fails without the rule), and a null written this page is not (fails
against the first attempt). After the fix the spec passed 16 of 16.

## Takeaway

**A throttled persister means any cache entry can be restored from up to a second ago.** For an
entry whose staleness decides what the screen treats as *current* — the live session above all —
"recently fetched" is not evidence of "still true". Ask of every such entry what a copy from a
second ago would make the app believe, not just what a copy from an hour ago would.

And, from how it was found: **when unrelated code makes a spec flaky, bisect before blaming the
flake, then read the trace before blaming the code.** The bisect showed the change was involved;
the trace showed it was only the trigger.

And from the first fix: **"a guard downstream suppresses it" is only true for the readers behind
that guard.** Before widening when a cache entry refetches, list every raw
`getQueryData`/`setQueryData` on that key, not just the hook's consumers.

A related, pre-existing race surfaced on the same lower run and is **not** fixed here (it also
failed the deploy before this one): tapping "Remove" on a Session-exercises entry while a set's
create is still on the wire cancels nothing (a request already sent cannot be recalled), so the set
lands and the entry comes back. That is what `parity-session-recap.spec.ts` › *reports nothing once
every logged set has been removed* catches on lower.
