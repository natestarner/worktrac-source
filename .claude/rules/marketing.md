---
paths:
  - "marketing/**"
---

# Marketing site invariants

Full narrative: `docs/marketing-site.md`.

## `prefers-reduced-motion`: capping `animation-duration` alone is not enough

`marketing/styles.css`'s reduced-motion block was found (2026-08-23, live-tested, not
theoretical) to leave every scroll-reveal section permanently at `opacity: 0` — capping
`animation-duration`/`animation-delay` to near-zero does **not** reliably make a
`fill-mode: both` animation land on its `to` keyframe in Chromium; the active window is short
enough to fall between two rendered frames, and the element sticks at its pre-animation state.

Any new CSS animation whose start state differs visually from its resting state (opacity,
color, transform — anything a viewer would notice) needs an **explicit** reduced-motion
override forcing the resting state, in addition to (not instead of) the duration/delay cap:

```css
@media (prefers-reduced-motion: reduce) {
  .your-animated-thing {
    opacity: 1 !important;
    transform: none !important;
  }
}
```

Don't trust "the duration is basically zero, so it'll look instant" without checking under
`prefers-reduced-motion: reduce` specifically (Playwright: `page.emulateMedia({ reducedMotion:
'reduce' })`) — the same gap likely exists in `frontend/src/index.css`'s reduced-motion block,
which uses the same duration-only pattern; that's a separate app-side fix, not covered by this
rule's `marketing/**` scope, but worth knowing before assuming either one is safe.

## `<video>` needs its own `height: auto` — the base `img` rule doesn't cover it

`styles.css`'s base rule is `img { max-width: 100%; height: auto; }`. `<video>` isn't an `<img>`,
so that rule never applies to it — and unlike `<img>`, an unstyled `<video>`'s `height` HTML
attribute applies as a real, literal CSS height (a low-specificity presentational hint) that
`width: 100%` alone does **not** override. Ship a `<video>` with `width`/`height` attributes
sized for its native resolution and only a `width: 100%` rule, and the box keeps that literal
height regardless of how far the width shrinks — barely visible at a wide column (~10% too
tall, letterboxed by the browser's own `object-fit: contain` default), badly broken at a phone
width (nearly 2x too tall, most of the card blank). Found on the deployed lower site, 2026-08-24,
after shipping to `main` with only a desktop-and-mid-width check.

Any `<video>` (or a selector that's meant to style both `img` and `video` together, like
`.figure`'s) needs an **explicit** `height: auto` alongside `width: 100%` — don't assume parity
with `<img>`'s styling just because the two look similar in markup. Verify at a genuinely narrow
width (390px), not just desktop: the distortion scales with how much the width shrinks, so a
desktop-only check can look "close enough" while a phone-width check is unmistakably broken.

## Product screenshots: real captures, with two documented manual exceptions

`marketing/assets/shots/` is meant to be fully reproducible via
`e2e/tools/marketing-capture.mjs` + `marketing-shots.mjs` (see `docs/marketing-site.md`). As of
2026-08-23 six files are a manual, undocumented-in-tooling exception (device-ipad.jpg,
device-iphone.jpg, app-log.jpg, app-trends-main.jpg, app-trends-secondary.jpg, plus the
household section's video) — see the blockquote in `docs/marketing-site.md` for what that means
before assuming the scripted pipeline will regenerate them.
