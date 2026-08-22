# Design canvas source

> **Status: superseded by the shipped page.** These artboards captured the first
> direction and the A/B hero decision. The live page has since moved on —
> different hero, warm-paper palette with the teal demoted to an accent, and real
> app screenshots in place of drawn mockups. Read them as the record of how the
> design was chosen, not as the current design. Re-seed from the shipped page if
> you want the visual editor to match again.

These `.dc.html` files are the **design** for the marketing site, not the site
itself. The site that ships is `marketing/index.html` + `marketing/styles.css`.

They are Design Components artboards, laid out by `canvas.json` and published as
a Claude Design canvas (an Artifact with a visual editor). Five artboards:

| File | What it is |
|---|---|
| `Main.dc.html` | Full desktop page, 1440w |
| `Mobile.dc.html` | Full mobile page, 390w (defaults to dark) |
| `Pricing.dc.html` | Pricing infographic on its own, with the comparison table |
| `HeroSplit.dc.html` | Hero direction A — product-first (what the live page uses) |
| `HeroStatement.dc.html` | Hero direction B — brand-first, full-bleed teal |

## These will drift, and that is expected

`marketing/index.html` is the source of truth for copy and for anything a
visitor actually sees. The artboards are fixed-width design surfaces — they are
not responsive, and they are not what gets deployed. When the two disagree,
**the shipped page wins.** Re-seed the canvas from these files when you want to
redesign; don't treat them as a spec to reconcile against.

## Re-seeding

```bash
# from marketing/design/
node "<design skill base dir>/seed-canvas.mjs" \
  --template "<design skill base dir>/payload.template.html" \
  --out huddle-landing-page.html \
  --title "Huddle Landing Page" \
  --artboard Main.dc.html --artboard Mobile.dc.html --artboard Pricing.dc.html \
  --artboard HeroSplit.dc.html --artboard HeroStatement.dc.html \
  --canvas canvas.json
```

Then republish that file to the existing artifact URL so the link stays stable.
The seeded output is gitignored — it is ~2 MB of editor payload.

Before re-seeding, check that no artboard outgrew its `canvas.json` frame — a
frame smaller than its content clips, and it is the only sizing mistake that
actually breaks the canvas:

```bash
cd e2e && npm ci && node tools/marketing-artboards.mjs
```

If someone has edited the canvas in the browser since, pull their changes back
down first with `seed-canvas.mjs --extract <saved page> --to <empty dir>`,
otherwise re-seeding overwrites their work.
