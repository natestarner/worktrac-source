# The Huddle brand kit (v3)

`huddle-tokens.css` and `huddle-tokens.json` in this folder are copied **verbatim** from the
brand kit and are the in-repo source of truth for the mark's colours and rules. The full kit —
the printable brand sheet, the icon-backgrounds sheet, and every exported file — lives outside
this repo at `../logo/v3/` relative to the repo root (i.e. beside `worktrac-source`, next to
`worktrac_SDLC_setup_guide.md`). The master logo is `logo/v3/logo/huddle-icon-light-bg.svg`.

## The four colours, and the one that isn't a colour

| Role | Value | Note |
|---|---|---|
| Orange | `#E8734A` | The large circle. **Never altered.** |
| Amber | `#F2A65A` | |
| Cream | `#F2EDE1` | **A mark colour, not a surface token** — see below |
| Rust | `#B5542D` | |
| Ink on light | `#3E3A37` | Wordmark |
| Ink on dark | `#F2EDE1` | Wordmark |
| Hairline | `#BDB6AF` | Cream circle outline, **light grounds only** |
| Dark surface | `#14100E` | |

Clear space on all sides is the large orange circle's radius (34 units on the mark's 200-unit
canvas, ~17% of the mark's width). Minimum sizes: horizontal lockup 120px wide, vertical lockup
84px, mark alone 16px. Below ~114px the 1.5pt hairline clamps to one device pixel.

## Two rules that are easy to get wrong

**1. `--color-accent` is not the mark's orange, and that is deliberate.** `#E8734A` is 2.93:1 on
`--color-bg` — under even the 3:1 bar for borders and the focus ring — and white on it is
3.01:1, which would drop the Log screen's primary CTA below AA Large. `--color-accent`
(`#d4673e`) is the same hue at 16° darkened until it clears those bars: the accessible
expression of the brand orange, not a stale value waiting to be corrected. The mark itself is
always brand-exact. Full table: `docs/architecture/design-system.md`.

**2. The hairline follows the GROUND, not the viewer's theme.** The cream circle is ~1.1:1 on a
white surface and needs the outline to exist at all; on a dark surface it is high-contrast on its
own and the brand sheet drops the outline. Most grounds in the app follow the viewer's scheme, so
`--brand-mark-hairline` (`#bdb6af` light, `transparent` dark) is right for them. `.plan-badge--pro`
is the exception — its pill is a fixed light gradient in *both* schemes, so it passes
`HuddleMark`'s `hairline` prop explicitly. A theme-keyed hairline there would erase the outline in
dark mode and dissolve the circle into the pill.

## What this repo ships, and from where

| Shipped file | Kit source | Theme-aware? |
|---|---|---|
| `frontend/public/icon.svg`, `marketing/assets/icon.svg` | **merged by hand** from `white/huddle-icon-light-bg.svg` + `dark/huddle-icon-dark-bg.svg` | **Yes** — internal `@media`; tile and hairline switch |
| `favicon.ico`, `favicon-{16,32,48}.png` | `white/` | No — one file |
| `apple-touch-icon.png`, `icon-{192,512}.png`, `icon-maskable-{192,512}.png` | `white/` | No — one file |
| `og-image.png` | **`dark/`** | No — a white card disappears against a white feed |
| `frontend/src/assets/huddle-lockup-*.svg` | `transparent/`, **canvas cropped** — see below | **Yes** — `<picture>` + `media` picks onlight/ondark |
| `frontend/public/email/logo.png` | `transparent/huddle-lockup-horizontal-ondark.png` | No — see the email note below |

The surfaces marked "No" have no variant mechanism at all: a `.ico`, an `apple-touch-icon`, a PWA
icon, the manifest's single `theme_color`, and `og:image` are one file each. They take the white
tile (dark for `og-image`) and that is the end of it. The per-scheme answer for browser chrome
lives in `frontend/index.html`'s **paired** `<meta name="theme-color">` tags, which is the only
place it can.

There is no in-app theme toggle. `prefers-color-scheme` is the single source of truth, read three
ways that stay in sync for free: CSS `@media` blocks, `<picture>`'s `media` attribute, and those
paired metas.

## The app's lockups carry a cropped canvas — do not "restore" it

`frontend/src/assets/huddle-lockup-*.svg` are the kit's `transparent/` lockups with **one edit:
the `viewBox` (and the matching `width`/`height`) is retightened to exactly the brand-minimum
clear space on all four sides.** No path, colour, or spacing inside the artwork is touched.

| File | Kit canvas | Shipped canvas |
|---|---|---|
| `huddle-lockup-horizontal-{onlight,ondark}.svg` | `0 0 462 200` | `3 16 456 168` |
| `huddle-lockup-vertical-{onlight,ondark}.svg` | `0 0 300 250` | `19.7 3.5 260.6 243.6` |

The kit bakes in 35.6–52.3 units of clear space horizontally and 36–48.6 vertically; the brand
minimum is the orange circle's radius, which is `34 × 0.96 = 32.64` in the lockup's coordinate
space (the mark group is `scale(0.96)`). Cropping to that leaves the rule satisfied exactly while
letting the header keep `height: 52` and render a 141×52 box against the previous asset's 145×52.
**Sizing from the kit's uncropped canvas instead would silently shrink the mark and grow the
header**, because the containers already supply their own padding.

One thing the crop cannot fix: the v3 lockups have a proportionally larger wordmark than the v2
ones (wordmark-to-mark height 0.61 vs 0.52). The mark and the wordmark therefore cannot both keep
their previous rendered size, and the brand forbids respacing the lockup. The call taken here was
to anchor the outer box and the wordmark — which is what carries perceived size and governs
layout — leaving the mark ~11% smaller than it was.

## Email is the one place the logo cannot follow the theme

The transactional templates use **one** logo PNG over a header band whose colour is fixed in both
schemes. That is deliberate: Gmail strips `<style>` in several contexts and Proton mobile rewrites
message colours regardless of what the template says
(Proton mobile was tested directly: forcing its "Light" message-display setting renders the
template as authored, while "Dark" and "System" re-colour it whatever the markup does), so a
two-`<img>` light/dark swap would leave some clients rendering a charcoal logo on a dark band —
invisible. A fixed band means the single logo file always has the ground it was drawn for.

The templates' light backgrounds ride on the legacy `bgcolor` HTML attribute rather than CSS
`background`, and the dark palette lives in a `@media (prefers-color-scheme: dark)` block using
`!important` against class hooks. Both mechanisms are load-bearing — recolour within them, don't
restructure them.

The masthead is `#14100E` with the cream-ink `ondark` lockup, over a `#F2EDE1` card. Two numbers
in there are derived rather than chosen:

- **The `<img>` is `231 × 100` inside `padding:24px 44px`** (it was `216 × 77` inside
  `36px 48px`). The v3 PNG bakes in ~24% vertical clear space against the old file's ~15%, so
  both had to move together to hold the band at 148px tall — it was 149 — and the gap from the
  band edge to the ink at ~48px. 231 rather than a round 232 because 1386÷600 is exactly 2.31;
  232 would squash the lockup by 0.4%.
- **The dark page ground is `#0A0807`, deliberately DEEPER than the masthead.** The band is fixed
  in both schemes, so at the old `#12181A` it landed at the same lightness as the dark page and
  the card's rounded top corners disappeared — the masthead read as page rather than as part of
  the message. Anything at or above `#14100E` reintroduces that.

One more trap, found by rendering it rather than reasoning about it: the success emails' check
circle must not be `#F2EDE1`. That is the card colour, so the circle vanishes and leaves a
checkmark floating in space. It is `#FBE9E0` (the app's `--color-pr-bg`) on light and `#3A2417`
on dark, with the check in rust `#B5542D` / `#E8935F` — the app's own celebration pair, which is
also the right meaning for "You're all set!".
