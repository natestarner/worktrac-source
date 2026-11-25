# The session bar blinked out when the next workout started while the last one was still ending

**Date:** 2026-11-25 · **Area:** offline machinery / log screen · **Fixed in:** `lib/liveSession.js`

## What a person saw

End a workout, then log the first set of the next one straight away (or reload and do it while
the End is still saving). On a connection with real round trips (lower, a phone on cellular), the
"Session in progress" bar disappeared for about a second, then came back. If "End this workout?"
was open at that moment, it closed by itself: the tap on End workout seemed not to take.

## How it surfaced

As a nightly "flake": `parity-session-recap.spec.ts`'s `"Just me" closes the sheet and stops the
question` needed a retry in Chrome on 2026-11-24 and in both Chrome and WebKit on 2026-11-25.
Chrome's failing attempt timed out clicking End workout inside "End this workout?": the button
was "not stable", then "detached from the DOM", and nothing matching ever came back. That reads like
a slow runner. It wasn't: the sheet was being closed.

## Cause

`fetchLiveSession` (the one fetcher of `queryKeys.liveSession`) already refused to let a server
"none" replace the new workout's `{ id: null }` placeholder while one of its sets was queued
(2026-11-02). But a live-session read that left **before the previous workout's End reached the
server** answers with that workout, which the server still thought was live. A real session always
replaced the placeholder, so the ended workout went back into the cache; `useLiveSession`
suppresses ended ids, so the hook returned `null`, the bar went, and `SessionBar` closed the asking
sheet (`if (endSheet && !endSheet.ended && !visible) setEndSheet(null)`). The next read (after the
set landed) restored the bar.

Measured with a temporary log in `fetchLiveSession` under a 750ms API delay: at the moment of the
"none" answer, the cache held `{"id":689,…}` (the ended workout), not the placeholder, with the new
set's create still pending. The 2026-11-02 guard never got to look at a placeholder.

## Fix

An answer naming a session `isSessionEnded` already knows about is treated like `null`: it keeps
the placeholder while a set is queued, and is returned as answered otherwise (so the hook's
suppression applies exactly as before). One code path in every mode.

## Proof

- `liveSession.test.js`: "keeps the placeholder when the server names a workout this device
  already ended" (red before the fix) and "takes an ended session as it was answered when nothing
  is queued".
- `session-bar-back-to-back.spec.ts`: samples the bar every animation frame through the second
  workout with the API delayed 750ms. Red 5/5 with the old `fetchLiveSession`, green 10/10 with
  the fix.

## Lesson

A diagnostic that *threw* inside the fetcher made the bug disappear (a failed fetch keeps the
query's previous data, the placeholder), which briefly read as "it doesn't reproduce any more".
Instrument with a `try/catch` around the log, and re-run without it before concluding anything.
