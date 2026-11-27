# 2026-11-26 — The Log search layer: no scroll in the app, flicker in Safari, and two regressions from the fix

> **Outcome:** the layer was then **abandoned for a search screen** the same day. A third failure
> on TestFlight run 40 was a ghost click taking the focus, so there was no keyboard. It was fixed on
> the unmerged branch `fix/search-tap-focus`, but Nate judged the layer overcomplicated. The full
> history, including that branch's simulator evidence and why every piece was removed, is in
> `docs/architecture/exercise-search-history.md`. This file stays as the post-mortem of the layer
> itself.

## Symptom

The full-screen exercise search (#630, closing #626) reached lower and Huddle Lower TestFlight
1.5.0 (38):

- **App Store app:** the search results could not be scrolled.
- **Safari:** the layer glitched and flickered, and the page behind it could be seen trying to
  scroll underneath.

The first fix (#632, TestFlight 1.5.0 (39)) brought two more reports, from the web and the app:

- "+ Add your own exercise", opened from the search, opened a dialog that could not be scrolled.
- Brave let the results scroll well past "+ Add your own exercise", into blank space.
- In the app, the results scrolled for some searches and not for others.

Every check before each release was green: unit tests, `keyboard-scroll.spec.ts` in Chromium and
WebKit, and Maestro flow 09 on the simulator.

## Root causes

1. **Safari flicker: the layer was placed from `visualViewport` in JS.** Its position and size came
   from `--visible-viewport-top` / `-height`, published a frame after each visualViewport event,
   so it chased every pan of Safari's visual viewport a frame late. Safari panned for two reasons:
   - The tap focused the field *at its place mid-page*, and only a frame later did React lift it
     into the fixed layer. Safari had already started panning toward the old position.
   - `lockBodyScroll` only set `overflow: hidden` on the body. iOS ignores that for touch: with
     the keyboard up, a drag still panned the page behind.
2. **App, stale layout: WKWebView did not always re-lay out the fixed layer after the window
   shrank.** `Keyboard.resize: "native"` shrinks the app's window above the keyboard (956 → 609 on
   the simulator), and `window.innerHeight` reported it correctly. But in one of two runs the layer
   stayed 956px tall: the `[search]` evidence logged `window 609 … layer 956`. With a stale height
   the end of the list sits under the keyboard, and a list shorter than the stale height has
   nothing to scroll. That is "it scrolls for some searches and not others".
3. **Regression from #632: a touch guard scoped to one element.** #632 cancelled every touch drag
   outside the results list. "+ Add your own exercise" opens its dialog *over* the still-open
   layer, so every drag inside that dialog was cancelled.
4. **Regression from #632: keyboard padding with no keyboard.** The list's end was padded by the
   keyboard's height at all times. Left over after the keyboard went, or inflated by Brave's
   toolbars, it let the list scroll into blank space.

## How the app cause was found, and two wrong theories on the way

No browser here shows WKWebView's keyboard, and both theories formed from reading code were wrong:

- **Wrong theory 1 (#632):** "a stale `visualViewport` height made the layer too tall". The answer
  was `inset: 0`. Simulator flow 09 then showed the list still not scrolling.
- **Wrong theory 2:** "the window doesn't shrink above the keyboard at all". This one was never
  shipped.

What settled it was logging from inside the app: `[search]` geometry and touch lines
(`logSearchEvidence`), read from flow 09's `console-09-*.log`. They showed:

- the window does shrink;
- touches reach the list, and none are cancelled;
- the list scrolls whenever the layer's size is right;
- the layer is sometimes stale at the old height.

**Measure inside the app before theorising.**

Flow 09 also passed through the original bug, because it never scrolled the results. Then, once
it did, it failed spuriously: each swipe took 9–12s on the runner, and 15s gave up 16px from the
end. Its timeout is now 60s.

## Fix

- **Layer size:** `top: 0; height: var(--window-height)`. `--window-height` is `window.innerHeight`
  in pixels, republished by `trackVisibleViewport` at once on every window resize. A changed value
  is a style change, which forces the layout.
- **Safari keyboard:** the list pads its end by `--keyboard-inset`, but only while the search field
  has focus (`:has(input:focus)`). iOS blurs the field when the keyboard goes.
- **Tap order:** a finger tap opens the layer **before** the field takes focus. The touchend is
  cancelled, the layer is opened with `flushSync`, and the field gets
  `focus({ preventScroll: true })`. A focus inside the touch handler is a user gesture, so iOS still
  raises the keyboard.
- **Touch guard:** `lockBodyScroll({ guardTouch: true })` cancels a touch drag only when nothing
  between its target and the body can scroll. Any scrollable box counts: the results, or a dialog
  opened over the layer. It is the same guard react-remove-scroll and React Aria's
  `usePreventScroll` install, added to the one shared lock rather than as a second mechanism.
- Dropped `-webkit-overflow-scrolling: touch`: a no-op since iOS 13.

## Why not a library

React Aria's `usePreventScroll` and react-remove-scroll solve only the touch-guard part, which is
about fifteen lines. React Aria's iOS path also has open reports for this exact layout on iOS 26.
Every real cause here was our own: placing from JS, focus order, a guard scoped to one element,
padding with no keyboard, and a fixed layer WKWebView did not re-lay out. No library would have
changed any of them.

## Takeaways

- **Size a full-screen layer `top: 0; height: var(--window-height)`.** Don't place it from
  `--visible-viewport-*`, and don't trust `inset: 0` inside the app.
- **On a phone, open an overlay before its field takes focus,** then focus the field in the touch
  handler with `preventScroll`.
- **A scroll guard must allow any scrollable box,** because something always opens on top of the
  overlay.
- **A scroll test has to scroll, with real input:** CDP touch drags in Chromium, a
  `scrollUntilVisible` with a runner-sized timeout in Maestro. A mouse wheel never reaches a touch
  guard.
- **For WKWebView behaviour, log from inside the app and read flow 09's console** before
  theorising.
