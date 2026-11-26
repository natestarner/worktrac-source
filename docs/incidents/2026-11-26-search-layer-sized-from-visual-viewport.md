# 2026-11-26 — The Log search layer could not scroll in the app, and flickered in Safari

## Symptom

The full-screen exercise search (#630, closing #626) reached lower and Huddle Lower TestFlight
1.5.0 (38). On the device:

- **App Store app:** the search results could not be scrolled at all.
- **Safari:** the layer glitched and flickered, and the page behind it could be seen trying to
  scroll underneath.

Every check before it was green: the unit tests, `keyboard-scroll.spec.ts` in Chromium, and
Maestro flow 09 on the simulator.

## Root cause

Three things, all in how the layer met the keyboard. None of them was a missing library.

1. **The layer was sized and placed from `visualViewport` in JS.** It used Modal's scrim recipe:
   `top: var(--visible-viewport-top); height: var(--visible-viewport-height)`, published by
   `trackVisibleViewport` one frame after each visualViewport event.
   - *App:* `Keyboard.resize: "native"` shrinks the WebView, so the right size is simply the
     window. A stale published height (iOS 26 has open reports of stale visualViewport values
     around the keyboard) left the layer taller than the window. The results then fit inside the
     too-tall layer, had nothing to scroll, and ran on under the keyboard. Reproduced in
     `keyboard-scroll.spec.ts` by making visualViewport report a full-height value after the
     window shrinks: the old CSS gave an **844px layer in a 420px window**.
   - *Safari:* every pan of the visual viewport moved `--visible-viewport-top`, and the layer
     followed it a frame late. That is the flicker.
2. **Safari was panning in the first place, for two reasons.**
   - The tap focused the field *at its place mid-page*, and only a frame later did React lift it
     into the fixed layer. Safari had already started panning toward the old position.
   - `lockBodyScroll` only set `overflow: hidden` on the body. iOS ignores that for touch: with
     the keyboard up, a drag on the search bar, or on a list with nothing left to scroll, still
     panned the page behind the layer.
3. **The tests could not see any of it.** Flow 09 never scrolled the results, and the e2e spec
   either drove the published values by hand (which the real tracker then corrected on the next
   frame) or used a mouse, which never takes the touch path.

## Fix

- The layer is `position: fixed; inset: 0`, pinned to the window and kept right by the browser
  on every frame. In Safari the results pad their end by `--keyboard-inset`, a new value from
  `trackVisibleViewport`, so the last result scrolls above the keyboard and nothing visible moves.
- A finger tap opens the layer **before** the field takes focus. The touchend is cancelled, the
  layer is opened with `flushSync`, and the field gets `focus({ preventScroll: true })`. A focus
  inside the touch handler is a user gesture, so iOS still raises the keyboard. Cancelling the
  touchend also stops a click landing on whatever the layer now puts under the finger.
- `lockBodyScroll({ touchScrollOnlyIn })` cancels every touchmove that would not scroll the
  results. It is the same guard react-remove-scroll and React Aria's `usePreventScroll` install,
  added to the one shared lock rather than as a second mechanism.
- Dropped `-webkit-overflow-scrolling: touch`: a no-op since iOS 13.

## Why not a library

We looked. React Aria's `usePreventScroll` and react-remove-scroll solve the "page behind
scrolls" half, which is about fifteen lines: a non-passive touchmove guard. React Aria's iOS path
also has open reports for exactly this layout on iOS 26 (a full-screen dialog with an input), and
its maintainers' advice is the sizing rule adopted here. The parts that actually broke were our
own: sizing from JS, and the order of focus versus open. No library would have changed either.

## Takeaways

- **Don't size or place a full-screen layer from `--visible-viewport-*`.** Pin it to the window
  and pad the scroller. Dialogs keep the visible-viewport scrim, because their field can be
  anywhere in them (`frontend-core.md`).
- **On a phone, open an overlay before its field takes focus.** Then focus it in the touch
  handler with `preventScroll`.
- **A scroll test has to scroll, with real input, against real published values.** Make
  visualViewport *report* the bad value, so the app's own tracker publishes it. Writing the CSS
  property by hand gets overwritten on the next frame and proves nothing.
- Pinned by `ExercisePicker.test.jsx`, `keyboard-scroll.spec.ts` ("whatever visualViewport says",
  "by touch"; both red-first, Chromium and WebKit) and flow 09's `scrollUntilVisible`.
