# The Log picker's exercise search: how it got to a search screen

The Log tab's "Search all exercises" field had a hard time on phones, the App Store app above all.
This file records every design that shipped or was tried, what broke each one, the evidence, and
where the code lives. If search on the Log tab ever needs to change again, read this first.

**Where it ended up:** a **search screen** (`feat/search-screen`). On the Log page the field is a
button that looks like a field. A tap switches the Log tab to an ordinary page: the field at the
top, Cancel beside it, and the results below in normal document flow, scrolled by the page itself.
The real field is focused in the same click handler, so iOS raises the keyboard. The current rules
are in `.claude/rules/log-screen.md`. Everything below is history.

## The constraint that drove all of it

The field sits **mid-page**, below the "Start a routine" block. Nate decided on 2026-11-26 that the
page order stays as it is. So tapping the field has to get it, and the results, above an iPhone
keyboard that covers about 40% of the screen.

The App Store app makes this harder than Safari:

- `Keyboard.resize: "native"` shrinks the whole WKWebView above the keyboard, so `100vh`, `dvh` and
  `window.innerHeight` all change while the keyboard animates.
- `@capacitor/keyboard` removes WKWebView's own "scroll the focused field into view".

## Design 1: scroll the PAGE to the field (builds 33-36)

**What it did:** on focus, scroll the page so the field sits at the top under the sticky chrome,
and show the results inline below it.

**Machinery:**
- `searchEngaged` and `scrollSearchIntoView` in `ExercisePicker.jsx`.
- `.picker-search-body`, a `min-height` so a short result list could not shorten the page under
  the field.
- `.exercise-search-input`'s `scroll-margin-top`.
- `data-reveal="start"` in `lib/visibleViewport.js`.
- `jumpAndSettle`'s `arrived` / `maxFrames`.

**What broke:** in the App Store app the WebView shrinks *while* the page is scrolling to the field.
The scroll clamped to the new, shorter page, or was dropped, about half the time on the simulator
(#621, #624, #627; TestFlight 1.4 rounds). Each build patched the aim; none made it hold. #626 asked
for a different approach.

**Code:** on `main` before `049e85d9`. #630 deleted the machinery.

## Design 2: a full-screen floating LAYER (#630, #632, #633; abandoned)

**What it did:** tapping the field lifted the *same* `<input>` into
`<div class="exercise-search-layer">`, a `position: fixed` layer over the whole screen. The field
was pinned at the top with Cancel beside it, and the results scrolled in an inner `overflow-y: auto`
box below.

The page underneath stayed rendered, marked `aria-hidden` and `inert`, and a slot held the field's
height. The layer was `role="dialog"` with a focus trap and `lockBodyScroll`.

The same element was reused so the focus, and with it the keyboard, carried over from the tap.

### Shipped as #630 (`049e85d9`), TestFlight 1.5.0 (38)

The layer was sized like Modal's scrim: `top: var(--visible-viewport-top)` and
`height: var(--visible-viewport-height)`, from `trackVisibleViewport`.

Reported by Nate on lower and TestFlight 38:
- **App:** the results could not scroll at all.
- **Safari:** the layer flickered, and the page behind could be seen moving.

Maestro flow 09 passed throughout, because it never scrolled the results.

### #632 (`ebbcf6dc`), TestFlight 1.5.0 (39)

The theory was that a stale visualViewport height made the layer too tall, and that Safari panned
because the field was focused mid-page. **The first half was wrong.** Changes:

- The layer was pinned with `position: fixed; inset: 0`.
- `--keyboard-inset` was published so the list could pad its end in Safari.
- A touch handler cancelled the touchend, opened the layer with `flushSync`, then called
  `focus({ preventScroll: true })`. The aim was "layer up before focus", so Safari would never pan
  toward the field's old place.
- `lockBodyScroll({ touchScrollOnlyIn: results })` cancelled every touchmove outside the results.
- `-webkit-overflow-scrolling` was dropped.
- New tests:
  - `keyboard-scroll.spec.ts`: "whatever visualViewport says" and "by touch".
  - Flow 09 gained a `scrollUntilVisible`.

Outcome:
- **Lower:** green.
- **TestFlight run 45871808420:** uploaded build 39. Flow 09 failed both attempts. The results did
  not move after four swipes (screenshots in that run's `mobile-flows-link-and-browser`
  artifact).

Nate then reported three things:
1. "+ Add your own exercise" opened from the search could not be scrolled, on the web and in the
   app. **Cause:** the results-only touch guard. That dialog opens *over* the still-open layer, so
   every drag inside it was cancelled.
2. Brave scrolled well past "+ Add your own exercise". **Cause:** `--keyboard-inset` padding applied
   when no keyboard was up.
3. The app scrolled for some searches and not others.

### Finding the app cause: logging from inside the app

Two theories from reading code were wrong:
- "The visualViewport height is stale."
- "The window does not shrink at all."

What settled it was `logSearchEvidence` in `ExercisePicker.jsx`, which writes `[search]` lines read
from flow 09's `console-09-*.log`:

- **geometry:** on every window and visual-viewport resize, the window height, the visible part,
  the layer's height, and the results' scrollTop/scrollHeight/clientHeight.
- **touch:** per finger, the target, the number of touchmoves and how many were cancelled, and
  scrollTop before and after.

The diagnostic runs were on branch `diag/search-scroll-app`, since deleted:

| Run | What it showed |
|---|---|
| 45876913336 | No evidence: GitHub's macOS pool never picked up two of the three shards ("not acquired by Runner of type hosted"). |
| 45881300709 | The window does shrink (956 → 609). Touches reach the list, 0 cancelled, and the list scrolls (0 → 355, 546 → 917). **In the retry, the layer stayed 956 tall in the 609 window.** WKWebView had not re-laid out the `inset: 0` fixed layer, while `window.innerHeight` was right. That explains "some searches": a short list fits the stale height, has nothing to scroll, and ends under the keyboard. Attempt 1 failed only because 15s allowed two swipes on a runner taking 9–12s per swipe-and-look; it stopped 16px from the end. |
| 45885959036 | After the fix below: flow 09 passed first time. Layer 546 of window 546 throughout, scrolled to 996/996. |

### #633 (`39ac5398`), lower only

- The layer became `top: 0; height: var(--window-height)`. `--window-height` is
  `window.innerHeight`, republished synchronously on every window resize; a changed value is a
  style change, which forces the layout.
- `lockBodyScroll({ guardTouch: true })` allows a drag in **any** scrollable box, and cancels only
  drags with nothing to scroll.
- Keyboard padding applies only while the field has focus (`:has(input:focus)`).
- Flow 09's scroll timeout became 60s.
- New test: `keyboard-scroll.spec.ts` "by finger drag" sends real touch drags through CDP. It fails
  on #632's code ("a drag inside the dialog scrolls it": 0).

Outcome:
- **Lower:** green, including `e2e-changed`'s burn-in.
- **TestFlight run 45893641364 (run number 40):** nothing uploaded. The simulator gate hung at its
  iPad screenshot step and was cancelled, so `ios` was skipped. The same hang hit #632's PR run;
  it is the runner's iPad simulator, not the app.
- **Flow 09 failed both attempts in a new way:** the layer was open, the field unfocused, no
  keyboard, and typing went nowhere ("search results is visible" was false). Screenshot: the
  placeholder showing and no focus ring.

### The ghost click, and the fix that was never merged

The cause is WebKit's synthetic mousedown/click for the tap. Cancelling the touchend does not
reliably stop it in WKWebView. It lands where the finger *was*, which after the layer opens is the
layer's empty background. A mousedown there takes the focus off the field. It is timing-dependent:
diagnostic run 45885959036 passed, while the busier release run failed both attempts.

The fix is on branch **`fix/search-tap-focus`** (`4a89ae71`), **unmerged by decision**. Its
worktree is kept at `.claude/worktrees/fix-search-layer-scroll`.

- **Focus first** (`input.focus({ preventScroll: true })`) while the field is still under the
  finger, then `flushSync` the layer open in the same task.
- If the focus did not take, **cancel nothing**: the browser's own tap focuses the field, and
  `onFocus` opens the layer.
- **Swallow the ghost** mousedown/mouseup/click in the capture phase for 500ms
  (`swallowGhostClicks`, the FastClick-era technique). It stops early if the picker unmounts;
  without that it leaked into the next tests and ate their clicks.
- `[search]` lines for the tap, any blur (with what took the focus), and each swallowed ghost.

Its checks:
- Unit tests: 3,623 passed.
- `ExercisePicker.test.jsx` ghost and fallback tests: red against `main`, green on the fix.
- Full local e2e: 569 passed.
- `keyboard-scroll` spec in Chromium and WebKit: green.
- Simulator, the same commit on two branches in parallel: `fix/search-tap-focus` run 45897081538
  and `diag/search-tap-focus-2` run 45897084565. Results: see "Final runs" below.

### Why it was abandoned

Every fix was real and tested, and every one existed only to prop up one decision: **moving the
field the person just tapped into a fixed layer while the keyboard opens.** That combined three
things iOS handles badly, and each produced its own bugs:

| iOS weak spot | Bugs it produced |
|---|---|
| A focused field that moves while the keyboard opens | Safari's pan toward its old place (flicker); the ghost click (no keyboard) |
| A fixed full-screen layer while the app's window resizes | Placed from visualViewport (a frame late); `inset: 0` left stale by WKWebView |
| An inner scroll container plus a page that must not scroll | `overflow: hidden` ignored by iOS for touch; the touch guard (froze the Add dialog); keyboard padding (Brave's blank space) |

Nate asked on 2026-11-26 whether this was overcomplicated. It was. The search screen removes all
three, because nothing moves while the keyboard opens and the page scrolls like every other page.

### The machinery the search screen deletes

All of this is on `main` at `39ac5398`, and in `fix/search-tap-focus`, if it is ever needed again:

- `ExercisePicker.jsx`: `searchOpen` plus the slot height, the `.exercise-search-layer` wrapper
  (`role="dialog"`, `data-keyboard-layer`), `handleTouchStart`/`handleTouchEnd`, `TAP_SLOP_PX`,
  `flushSync`, `logSearchEvidence`; and on the branch, `swallowGhostClicks` and `GHOST_CLICK_MS`.
- `index.css`: `--z-search-layer`, `.exercise-search-layer`, `.exercise-search-bar`,
  `.exercise-search-results(-inner)` and the `:has(input:focus)` padding rule.
- `lib/bodyScrollLock.js`: the `guardTouch` option and `canTouchScroll`, which no other overlay
  used.
- `lib/visibleViewport.js`: `--window-height`, `--keyboard-inset`, the window resize listener, and
  the `[data-keyboard-layer]` skip in `revealFocusedField`.
- Tests:
  - `keyboard-scroll.spec.ts`'s layer cases: "tapping the search opens a full-screen layer",
    "whatever visualViewport says", "by touch" and "by finger drag";
  - the matching `ExercisePicker.test.jsx` and `visibleViewport.test.js` cases;
  - `e2e/tests/support/exercises.ts`'s `closeSearch` / `clearSearch`.

**Lessons that outlive the design:**

- **For WKWebView behaviour, log from inside the app and read the simulator console before
  theorising.** Two theories here were wrong until the app reported its own geometry.
- **A test about scrolling has to scroll, with real input.** Flow 09 passed for weeks without
  scrolling. A mouse wheel never reaches a touch guard; CDP touch drags in Chromium do.
- **A scroll or touch guard must allow any scrollable box.** Something always opens on top.
- **Size Maestro timeouts for the runner.** Swipe-and-look took 9–12s each on a loaded runner.
- **Two runner-side failures that look like app failures:** the iPad screenshot step hanging in
  `mobile-ci`, and macOS jobs never acquired by a runner. Read the step and the annotation before
  blaming a commit.
- Libraries were considered and rejected: React Aria's `usePreventScroll` and react-remove-scroll
  each cover only the touch-guard part, and React Aria's iOS path had open iOS 26 reports for
  exactly this layout.

## Final runs of the abandoned fix

Both simulator runs of `fix/search-tap-focus` (`4a89ae71`) passed every flow, flow 09 included, on
the **first** attempt. The app's own lines prove the ghost-click diagnosis rather than just
passing:

- **Run 45897081538:**
  - `[search] tap: layer open, field focused true`, then `ghost mousedown swallowed`,
    `ghost mouseup swallowed`, `ghost click swallowed`.
  - So WKWebView **did** send the synthetic mouse events after the touchend had been cancelled,
    and swallowing them kept the focus.
  - The layer then followed the window (609 of 609), and drags scrolled the list (0 → 356, none
    cancelled).
- **Run 45897084565:** the field was focused at the tap, and no ghost arrived that time (the
  timing varies). The layer was 546 of 546, and the list scrolled to its end (996/996).

So the layer, with all four fixes, did work on the simulator. It was abandoned for its complexity,
not because it could not be made to work. If it is ever revived, start from `fix/search-tap-focus`,
not from `main` at `39ac5398`, which lacks the ghost-click fix.

## What is where

| Thing | Where |
|---|---|
| The search screen (current) | `feat/search-screen`, then `main`; rules in `log-screen.md` |
| The layer as shipped | `main` at `39ac5398` (#630, #632, #633) |
| The unmerged ghost-click fix | branch `fix/search-tap-focus` (`4a89ae71`); worktree `.claude/worktrees/fix-search-layer-scroll` |
| Its parallel simulator copy | branch `diag/search-tap-focus-2` (same commit); **deleted 2026-11-26** with the other leftovers (worktrees `search-settle`, `testflight-1-4-round2`; branches `fix/search-settles-at-top`, `fix/1-4-round-two`, `diag/search-settle-sample-2`). Only `fix/search-tap-focus` is kept |
| History's and PRs' search (a different field) | `ExerciseFilterBar.jsx`: a real field mid-page, kept as it is; it puts the keyboard away on the Search key and when a finger drags the page (2026-11-26), because scrolling its matches with the keyboard up left the SessionBar riding on the keyboard in Safari and the app |
| The post-mortem | `docs/incidents/2026-11-26-search-layer-sized-from-visual-viewport.md` |
| TestFlight builds | 1.5.0 (38) = #630; (39) = #632; run 40 uploaded nothing |
