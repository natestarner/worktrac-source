# The sticky modal header clipped the first field's top border

**Date:** 2026-08-10
**Area:** Frontend — `components/shared/Modal.jsx` (every modal in the app)
**Symptom:** In New/Edit routine, Add exercise, Copy to, Customize this exercise, Add a person —
every `Modal`-based dialog with a title — the top border of the first field right below the
header was missing or looked clipped, as if the header were painted slightly too far down.

## What happened

There were two distinct bugs stacked on top of each other, both stemming from the same header
markup, and each looked like a smaller version of the same symptom.

### Bug 1: the negative-margin bleed conflicted with `position: sticky`

The header bled its background out to the panel's edges by canceling the panel's own padding with
a negative margin:

```js
margin: 'calc(var(--space-6) * -1) calc(var(--space-6) * -1) var(--space-4)',
padding: 'var(--space-6) var(--space-6) var(--space-3)',
```

That's a standard trick for a *static* element. But this header is `position: sticky` (needed so
the close X stays reachable when a tall modal like the routine form scrolls under its own
`maxHeight: 80vh`). A sticky element's "stuck" offset is resolved from its **margin box** against
the scroll container's padding edge. Because the header's resting position already satisfied
`top: 0`, it was "stuck" from the very first frame — and once stuck, the browser re-anchors it
using that margin-box math, which **discards the negative top margin's bleed for painting**. The
space reserved for the next sibling in layout, though, is still based on the *original* bled
static position. Measured directly against the running app: the header painted **8px lower**
than the position layout reserved for it (`space-6` minus `space-4`), silently painting over the
top of whatever field came next.

Fix: stop relying on negative margins to bleed the header to the panel's edges. The panel itself
now carries no padding at all; the header owns its own padding, and a new wrapper div around
`{children}` owns padding for everything else.

### Bug 2: even a 0px gap wasn't safe, because of stacking order

The first fix made the header's box and the first field's box land at an *exact* shared boundary
(a measured `0px` gap — touching, not overlapping). That looked correct in a downscaled
screenshot review and in headless-Chromium screenshots taken for verification, but a real user on
a real screen could still see the field's top border missing.

The header is `position: sticky` **with a `z-index`**, which gives it an elevated stacking
context. Positioned, stacked content paints **above ordinary flow content regardless of DOM
order** — so even though `getBoundingClientRect()` showed the two boxes as merely adjacent, any
sub-pixel rounding during rasterization on a real, GPU-accelerated browser could paint a hairline
of the header over the field's border at that exact seam. Headless-Chromium screenshots didn't
reproduce it reliably, which is exactly why it survived one round of "verified against the
running app."

Fix: don't let the visual gap depend on an exact touching boundary between an elevated element
and ordinary content. Most of the gap now lives on the **plain, non-positioned** wrapper below
the header, not the header's own padding — a real, unambiguous number of CSS pixels the header
cannot paint over no matter how sub-pixel rounding goes, rather than a coincidence of two boxes
landing on the same line.

## Rules this produced

- **A sticky/positioned element with a `z-index` paints above ordinary flow content regardless of
  DOM order.** Never rely on an exact (0px) shared boundary between such an element and ordinary
  content for a border or fine visual detail to render correctly — leave a real, non-zero gap,
  and put that gap on the non-positioned side of the boundary.
- **Headless-browser screenshots are not sufficient proof for hairline/sub-pixel rendering
  claims.** They can look identical to the buggy and fixed states while a real, GPU-rasterized
  browser visibly differs. Pixel-geometry assertions (`getBoundingClientRect`) catch *overlap*;
  they do not catch *paint-order* artifacts at an exact touching boundary. When a report survives
  a `getBoundingClientRect`-verified fix, suspect stacking/paint order, not layout, next.
- `Modal.jsx`'s panel carries no padding of its own anymore — the sticky header and the content
  wrapper each own theirs. Don't reintroduce padding on the panel itself or a negative margin on
  the header to "simplify" this; see `.claude/rules/frontend-core.md`.
