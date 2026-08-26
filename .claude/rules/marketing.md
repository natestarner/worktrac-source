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
2026-08-26 four files are a manual, undocumented-in-tooling exception (device-iphone.jpg,
app-log.jpg, plus the household section's video and poster) — see the blockquote in
`docs/marketing-site.md` for what that means before assuming the scripted pipeline will
regenerate them. `device-ipad.jpg`, `app-trends-main.jpg` and `app-trends-secondary.jpg` were
re-sourced 2026-08-26 from real on-device iPad captures (see below) and are no longer part of
this exception, though they're still not produced by the scripted pipeline either — they were
hand-cropped once, not wired into `marketing-shots.mjs`.

## Device-framed screenshots must use the device's real aspect ratio, not a content-tight crop

`device-ipad.jpg` used to be cropped tight to its interactive content (no dead space below the
"Log set" button) — reasonable for a plain card, but the hero wraps it in `.device`'s CSS bezel,
where the crop's own aspect ratio *is* the device's apparent shape. A content-tight crop is
nowhere near a real iPad's (it was 1400×692, ~2.02:1; a real iPad landscape is ~1.3–1.4:1), so
the bezel read as a wide, flat panel rather than a tablet. The mask-fade this file's other
section describes was partly hiding this — fading the bottom out meant the wrong proportions
never resolved into a hard, legible edge.

**Fix: use the device's full real screenshot, status bar and all**, not a tight content crop —
`device-ipad.jpg` is now a real iPad Air 11" capture (2360×1640 native, ~1.44:1) resized to
1700×1181, letting the correct aspect ratio come from the source rather than being reconstructed
after the fact. This only matters for the **device-framed** images (currently just the hero) —
`.figure`-card screenshots (Log screen, Trends) aren't device silhouettes, so they can crop to
any shape without looking wrong; keep cropping those to content, excluding OS chrome, as before.

## Shadow depth: `--contact-shadow`, not a new box-shadow value

The hero's device pair and every `.figure`/`.figure--quiet` card share one mechanism for "this
sits above the page" depth: the `--contact-shadow` token (defined in both the light `:root`
block and the dark `@media` override, like every other elevation token in this file) layered
alongside each element's own `--shadow-4`/`--shadow-3`. **Reuse it — a new one-off shadow value
here is the second way to do the same job.**

- `.hero__devices::after` layers it as a blurred radial-gradient ellipse positioned *behind* the
  device pair, because `.hero__devices` has no `overflow: hidden` to fight.
- `.figure`/`.figure--quiet` layer it as a second `box-shadow` value instead, because `.figure`
  needs `overflow: hidden` to clip screenshots to its rounded corners, and **a pseudo-element
  extending outside the box would be clipped by that same rule.** A box-shadow is not: an
  element's own shadow is decoration on its border-box, not content, so the element's own
  `overflow` never clips it. Reach for the box-shadow form wherever the card already clips its
  content; the pseudo-element form only where there's nothing to fight.
- **Dark mode needs its own token value, not the light one at higher opacity applied
  uniformly.** A dark contact shadow is close to invisible against `--color-bg` in dark mode —
  both are near-black — the same way `--shadow-4` alone read as no depth at all before this fix.
  `--contact-shadow` swaps to pure black at higher opacity in the dark override, mirroring
  `--shadow-4`'s own light→dark jump (0.2 → 0.7 opacity).

Found 2026-08-26: the hero's device pair used to fade out at the bottom via a CSS `mask-image`
rather than cast a shadow. That mask was quietly swallowing each device's own `box-shadow` too —
a mask clips everything painted for the element, shadow included — which is part of why the pair
read as dissolving into the page rather than resting on it.

## Regenerating the household video needs `ffmpeg`, and the source is HEVC, not H.264

`ipad_video_showcase.MP4`-style source recordings from an iPad are **HEVC** (`hvc1`), not H.264.
Chromium — including Playwright's bundled build — cannot decode HEVC, so loading one into a
`<video>` element (e.g. to pull frames via canvas, as `docs/marketing-site.md`'s household-video
section assumed) hangs forever waiting for a `loadedmetadata` event that never fires. This isn't
a timeout to raise; the browser genuinely cannot read the file.

There is no system `ffmpeg` on the dev machine this was found on, and installing one via
`choco install ffmpeg` fails without admin rights (`Cannot create directory
"C:\ProgramData\chocolatey\lib-bad"`). **A portable static build works with no install and no
admin rights**: download `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip`,
unzip anywhere writable, and call `<extracted>\bin\ffmpeg.exe` by full path. That single binary
handles probing (`-i` with no output), scanning content via a contact-sheet
(`-vf fps=1,tile=NxM`), trimming (`-ss`/`-t`), cropping (`-vf crop=...`), and the final VP9
encode (`-c:v libvpx-vp9`) — no Chromium/canvas workaround needed at all once ffmpeg is
available.
