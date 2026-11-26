# The dialog-glide spec counted the runner's frames, so it failed in lower's WebKit run (2026-11-26)

## Symptom

`modal-keyboard-hold.spec.ts` › "a dialog the keyboard would cover glides up just far enough, never
jumps" (added by #631) failed all 3 attempts in its first nightly WebKit run on lower, and all 3
again on the re-run of the failed job (run 45878141872, attempts 1 and 2):

- `one frame carried 149px of a 197px move` (also 91, 128, 83px on the re-run)
- `the dialog arrived in 4 frame(s), not a glide`

It passed in Chromium on lower, and in WebKit locally (15/15).

## Root cause

The spec judged "a glide, not a jump" by sampling the dialog's top every animation frame and then
requiring at least 5 frames with movement and no single frame carrying more than a third of the
move. Both numbers describe the runner's frame rate, not the app.

The trace from attempt 1 holds the sampled tops: `311, 311, 154, 124, 115, 114, 114, ...`. That
is 14 samples in ~550ms (about 25 frames a second), with one ~110ms gap right after the resize,
which is the browser doing the resize itself. The Modal's `padding-top var(--dur-slow)
var(--ease-out)` transition (280ms, `cubic-bezier(0.2, 0, 0, 1)`) is about 80% done at 110ms, so
that one frame carried 157px of the 197px move. The dialog was easing exactly as designed, and a
slower frame rate was all it took to fail.

Locally it reproduces on demand under load: 12 WebKit workers × 40 repeats of the unchanged spec
failed **29/40**, all with `one frame carried Npx of a 197px move`.

## Why it is not a product bug

The move is one CSS transition on a time-based timeline. A runner that draws fewer frames shows
fewer of its steps, but where the dialog is at any instant is the same. On a device, the real
keyboard's timing against the transition is still something only a device can show (the spec's
header says so).

## Fix

The spec now judges the glide by the transition itself, not by frames. Before the resize it
listens for the scrim's `transitionrun` on `padding-top`. When the transition starts, it takes the
`CSSTransition` from `getAnimations()`, pauses it, and measures the dialog with it held at
`currentTime` 0 (it must still be where it was, so nothing moved outside the transition) and at
half the duration (it must be strictly between start and end). Then it lets the transition run.
It also checks the duration is a real one (≥ 200ms). Frame samples are kept only for "it never
moved back down", which holds at any frame rate.

Verified:

- Under the same load (12 workers × 40, WebKit): **40/40** pass, against 29/40 failing before.
- Red against the old re-centring Modal (`edbcdb9e^`): **3/3** fail with "no padding-top
  transition carried the move: it jumped".
- The whole file ×10 in Chromium and in WebKit: 30/30 each.

No timeouts were raised and no retries added.

## Takeaways

- A frame count or largest per-frame step measures the machine, not the animation. To prove a
  transition happened, catch the transition and read it at chosen points on its own timeline.
- Frame sampling is still right for "this was never shown" and "it never moved the wrong way",
  claims that hold at any frame rate (`.claude/rules/e2e-tests.md`).
