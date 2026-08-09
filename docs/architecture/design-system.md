# Design system

Why this exists, and what each token is for. The enforceable rules live in
`.claude/rules/frontend-core.md`; this is the reasoning behind them.

## The problem it solves

The frontend was styled ~95% through inline `style={{}}` objects and ~90 file-local style
constants. Colour had a token layer; nothing else did. Three consequences compounded:

1. **Inline styles cannot express `:hover`, `:active` or `:focus-visible`.** That is why the app
   had zero transitions, no press feedback, and no keyboard focus indicator anywhere — not an
   oversight, a dead end. `-webkit-tap-highlight-color: transparent` also removed the one piece of
   native tap feedback iOS gives, with nothing replacing it.
2. **No scale for type, space, shadow or motion**, so every call site invented its own: 17 font
   sizes between 9 and 40px at 1px granularity, 13 border radii, 8 one-off shadows, ~40 distinct
   padding pairs. The most common padding was `14` and the most common gap `10` — both off any 4px
   grid, so nothing landed on a shared baseline.
3. **No primitives.** The card recipe was retyped ~25 times, the uppercase section label was
   redefined in 8 files at 3 different sizes, `editLinkStyle` was copy-pasted verbatim into 5.

The loudest symptom: `fontWeight: 700` appeared **132 times** and `400` appeared **3**. Almost
every string was bold, so the eye had no path through a screen.

## Where things live

| Layer | Where | For |
|---|---|---|
| Tokens | `frontend/src/index.css` `:root` | Every value the UI draws with |
| Interaction states | `index.css`, `.pressable` + `:focus-visible` | Hover, press, focus, reduced motion |
| Component classes | `index.css` component layer | `.btn-*`, `.card`, `.input`, `.seg`, `.chip`, `.icon-btn` |
| React primitives | `components/shared/` | `Button`, `Card`, `Input`, `IconButton`, `SectionLabel`, `EmptyState` |
| Icons | `components/shared/icons.jsx` | Vendored Lucide paths |

## The three accent tokens

This is the single easiest place to reintroduce a contrast bug, so it's worth understanding.

The brand terracotta `#d4673e` is **3.44:1 on `--color-bg`** — below the 4.5:1 AA needs for normal
text, and white-on-accent is 3.62:1. One hex cannot do every accent job legibly:

| Token | Value | Use it for | Why |
|---|---|---|---|
| `--color-accent` | `#d4673e` | Fills behind large bold text, borders, icons, chart marks, focus ring | Only needs 3:1 for these; keeps the brand colour |
| `--color-accent-strong` | `#b8552f` | Fills for small/medium filled buttons | White label reaches 4.80:1 |
| `--color-accent-text` | `#a8532c` light / `#e07a52` dark | Accent-coloured text at normal sizes | 5.07:1 / 5.52:1 |

The one place `--color-accent` is a button fill is the Log screen's primary CTA, and that works
*because* it's `--text-xl` at weight 700 — past the AA Large threshold (≥18.66px bold), where
3.62:1 passes. `.btn-lg.btn-primary` encodes exactly that exception. A bigger primary CTA is also
simply better for a tool used mid-set.

## `--color-faint` is not a text colour

At its original `#b4afa6` it was **2.07:1** — it failed even the 3:1 bar for control boundaries,
and it was being used for empty-state body copy. Rather than darken it into `--color-muted` (which
would collapse the three-step text ramp), it keeps only its non-text roles — dividers, inactive
glyphs, the dashed "+ Add person" border — and every text use moved to `--color-muted`.

## Dark mode is derived, not flipped

`--color-success` and `--color-danger` were originally left at their light-mode values in the dark
theme and sat at ~3.3:1 — under AA while carrying every success and every destructive affordance.
They're re-derived toward the muted/warm end rather than a saturated neon, which would fight the
terracotta.

One non-obvious constraint: **dark `--color-danger` must stay visually separable from
`--color-pr-text`.** The obvious brighter reds (`#e8836a`, `#f0907a`) land within 1.1:1 of the PR
orange — the same colour to the eye — which would make a failure and a personal record
indistinguishable. `#e07a5f` clears it at 1.23:1.

Shadows are re-derived too. A drop shadow reads as depth by darkening what's behind it, and there
is nothing left to darken below `#221f1c`, so dark mode deepens the shadow *and* adds
`--elevation-hairline` — a light top inset that does the work of catching the light source, the way
native dark UIs do it. Pair them: `box-shadow: var(--shadow-3), var(--elevation-hairline)`.

## Weight carries hierarchy

Body copy is `--weight-normal` (400). Labels, links and buttons are `--weight-semibold` (600).
`--weight-bold` (700) is for headings and the single most important number in a block. `800` is
retired. Spend 700 sparingly or it stops meaning anything — which is exactly what had happened.

## Button hierarchy

`primary` / `secondary` / `ghost` / `danger` / `danger-solid` / `dark`, in `sm` / `md` / `lg`.

**At most one `primary` visible per screen.** The History tab previously put "+ Log a past workout"
(filled) directly beside "Export data" (outlined) — two equal-weight actions with two different
treatments and no rule saying what the difference meant. Both are `secondary` now.

Minimum heights are the iOS 44px target (`sm` is 40px for dense contexts). The primary navigation
was ~35px and the Trends switchers ~28px before this.

## Motion

`--dur-fast` (120ms) for press, `--dur-base` (180ms) for hover and colour, `--dur-slow` (280ms) for
enters and exits. Durations are short deliberately: this is a tool used mid-set, and anything that
makes the UI feel like it's waiting on an animation is wrong.

Two things are easy to get wrong:

- **Guard `:hover` with `@media (hover: hover)`.** Without it iOS applies `:hover` on tap and leaves
  the control lit until you touch something else.
- **`prefers-reduced-motion` reduces animations to one instantaneous frame rather than removing
  them**, so anything depending on an `animationend` event still fires.

## Icons

`components/shared/icons.jsx` vendors ~16 Lucide paths (ISC, attributed in the file) rather than
depending on `lucide-react`: we need 16 of 1500+, the frontend keeps its runtime dependency list
short, and the barrel import makes Vite pre-bundle ~1500 modules on a cold dev start.

These replaced emoji (📝, 📌), which render as full-colour platform-specific art — they ignore the
theme, ignore the accent colour, and look different on every OS.

**Not everything glyph-shaped should become an icon.** The `+` in "+ Add person", the stepper's
`+`/`−` and the keypad's `⌫` stayed as text: they render identically everywhere, inherit colour and
weight, and were never the problem. They are also what 17, 10 and 3 test call sites respectively
select by. See the testing note below.

## Testing constraint worth knowing before you change any label

Both test layers select controls by their accessible name, and they behave differently:

- **Playwright** matches `getByRole(role, { name })` as a **case-insensitive substring** unless you
  pass `exact: true`. So a new control whose label *contains* an existing one on the same screen
  ("Edit note for this session" beside "Edit") will break a `toHaveCount` assertion elsewhere.
  Keep labels on one screen mutually non-containing.
- **React Testing Library** matches the accessible name as a **full string**.
- **RTL's `getByText` concatenates only DIRECT text-node children.** Splitting a string into spans
  for styling — e.g. dimming the unit in `135 lb × 8` — silently breaks every `getByText` on it.
  That specific change was tried and reverted; ~20 assertions in `ExerciseDetail.test.jsx` look
  rows up that way and then navigate via `.parentElement`.

When converting a text button to an icon button, the icon is `aria-hidden` and the **button** keeps
the label, verbatim.

## PWA

The manifest declares `display: standalone`, so `index.html` sets `viewport-fit=cover` and the
chrome classes use `env(safe-area-inset-*)`. Without `viewport-fit=cover` those insets all resolve
to `0px`. `theme-color` has light and dark variants and tracks `--color-bg`, not the accent.

## Deliberately not migrated

The admin portal (separate chrome, internal-facing) and the Recharts internals in
`ExerciseTrendChart` / `WeeklyFrequencyChart` / `WeeklyMetricChart`. Their duplicated tooltip markup
is worth a pass, but it's a distinct concern.
