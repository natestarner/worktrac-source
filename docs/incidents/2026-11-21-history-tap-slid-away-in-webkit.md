# A tap on History slid off its button in WebKit, so the menu never opened (2026-11-21)

## Symptom

`history-long-list.spec.ts` failed in the nightly WebKit run on lower, on and off, from at least
2026-10-25 (#440): at least one attempt in 3 of the 5 nightlies up to 2026-11-21, and all 3
attempts that night. Every failure was the same. The spec taps "View options for Barbell Row" on a
workout ten months down a year of History. Playwright reports the tap as done, no menu opens, and
the test waits out its whole 3.5 minutes for "View this exercise's history". Chrome never failed.

## Root cause

Two things together, both specific to WebKit at phone size:

1. **Playwright's scroll in mobile WebKit does not reach the page until the next input event.**
   After `scrollIntoViewIfNeeded()` the page's own `getBoundingClientRect()` still put the button
   at its old position (7,667px down), and it stayed there through 15s of retries. The scroll
   became visible to the page only when the click's press arrived.
2. **History's blocks resize when first drawn, and Safari has no scroll anchoring.** Each workout
   block carries `content-visibility: auto` and an estimated height (`estimatedSessionBlockHeight`)
   until it is drawn. Here the estimate was 9-31px taller than the real block. When the scroll
   finally landed, three blocks above the target were drawn and shrank by 60px between them, and
   without anchoring everything below moved up 60px.

So the scroll, the drawing and the slide all happened **during the press**. Measured in the page
with capture listeners (`mousedown` → frame → `click`):

| ms | event | y | button top | target |
|---|---|---|---|---|
| 438 | mousedown | 647 | 636.8 | **the button** |
| 441 | frame: 3 blocks resize, page 60px shorter | | 576.8 | |
| 445 | click | 647 | 576.8 | **`.history-card`** (the card around it) |

A browser sends a click to the nearest element the press both started and ended on, so a press
that starts on the button and ends below it is a click on the card. The button's `onClick` never
ran. Playwright's "stable" check runs before its scroll, never after, so nothing in its
actionability checks could see this. It depended on whether the resize frame fell between press
and release: 4 of 40 locally, more on a loaded CI runner.

The lower trace (run 44924791005) shows the same thing from outside: the first click attempt found
the button "outside of the viewport" right after scrolling it into view, and in the screencast
right after the retry's click the button sits at the un-shrunk position, 60px below where the click
landed.

## Why it is not a product bug

A person's tap arrives after a scroll, not as part of it: a finger scroll draws blocks as they come
into view, and a person taps what has stopped moving. The app's own long jump already re-aims every
frame until its target holds still (`jumpAndSettle`).

## Fix

The spec scrolls from inside the page (`el.scrollIntoView({ block: 'center' })`), which takes
effect at once, waits until the button has kept its position for three frames (`holdsStill`, the
same rule as `jumpAndSettle`), checks it is wholly on screen, and only then clicks. Nothing is left
for `click()` to scroll. No timeouts were raised and no retries added.

Verified in WebKit locally: the unmodified spec failed 4/40, all with lower's error. With the fix:
80/80 passed in WebKit, and 10/10 in Chromium.

## Takeaways

- In mobile WebKit, don't trust Playwright's scroll to have reached the page before the click.
  Scroll inside the page and wait for the target to settle (`.claude/rules/e2e-tests.md`).
- A click that "succeeds" without its handler running can mean press and release landed on
  different elements. Capture-phase `mousedown` / `click` listeners show it in one run.
- Why the first attempt at a fix failed: `toBeInViewport()` reads an IntersectionObserver, which
  reports nothing within a 1ms timeout, so it read "ratio 0" every time. A check made inside the
  same animation frame as the measurement doesn't have that problem.
