# The marketing site (huddle.fitness / dev.huddle.fitness)

`marketing/` is a plain static landing page served from its own pair of Azure
Static Web Apps, separate from the app. This document covers why it is separate,
how it deploys, and the one-time Azure + DNS cutover.

## Why a separate Static Web App

Three reasons, in order of how much they mattered:

1. **SWA route rules have no host matcher.** One Static Web App cannot serve
   different content to `huddle.fitness` and `app.huddle.fitness`. Binding the
   apex to the existing app would have shown marketing to everyone hitting the
   bare app domain.
2. **Free tier caps at 2 custom domains, and both app SWAs were already at 2/2**
   (`*.starnerconsulting.co` plus `app*.huddle.fitness`). Nothing more could
   attach without unbinding something.
3. **A marketing page should not boot React.** The app's landing path costs a
   bundle download, a `config.json` fetch and an auth hydrate before first paint.
   A static file paints immediately and indexes properly.

Both marketing SWAs are Free tier, so this costs nothing.

## What was there before

The apex was **not** wired through Azure or either repo. `huddle.fitness` and
`www.huddle.fitness` were `A` records pointing at `162.255.119.24`, Namecheap's
URL-forwarding service, which answered `301 → https://app.huddle.fitness`.

Two things worth knowing about that arrangement:

- **`https://huddle.fitness` was broken.** Namecheap's forwarder answered on
  port 80 only; TLS connections timed out. Binding the apex to a SWA is what
  finally gives the apex a working certificate.
- **`dev.huddle.fitness` never existed.** There was no DNS record of any kind,
  so it was not redirecting anywhere — it simply failed to resolve.

## How it deploys

Same shape as the frontend: source builds, deploy repo deploys.

```
marketing/**  ──►  marketing-ci (scripts/check-marketing.sh)
                      │  uploads artifact "marketing-build"
                      ▼
              promote-to-lower  ──►  worktrac-deploy@lower : marketing-build/**
                                            │
                                            ▼  push triggers deploy-lower.yml
                              cp config/lower/marketing-robots.txt → robots.txt
                              Azure/static-web-apps-deploy@v1  (marketing SWA lower)
                                            │
                                            ▼  manual promotion to `production`
                              same steps against the production marketing SWA
```

There is **no build step**. The directory ships exactly as authored, which is
why `scripts/check-marketing.sh` exists — it is the only thing between a typo'd
asset path and a 404 in production. It runs in CI and is worth running by hand
before pushing.

### The one per-environment difference

Both environments get byte-identical files. `marketing/app-links.js` rewrites
the CTA links to `app.dev.huddle.fitness` and injects a `noindex` meta at
runtime when the hostname starts with `dev.`. This is environment config, not a
connectivity branch — it does not belong on the resilience register in
`.claude/rules/resilience.md`, which governs `frontend/src`.

`robots.txt` is swapped at deploy time instead, mirroring the existing
`config.json` correction, so the lower site is disallowed even to a crawler that
ignores the meta tag.

### No CORS change is needed

Every CTA is a plain link to `app.huddle.fitness`. The marketing site makes no
API calls, so `CORS_ALLOWED_ORIGINS` does not need `huddle.fitness` added. If a
form is ever added here (a waitlist, a newsletter), that stops being true and
the origin has to be added to both `backend-env.json` files in the deploy repo.

## One-time setup

### 1. Create the Static Web Apps

Azure Portal → Static Web Apps → Create, in `worktrac-rg`, region East US 2,
plan **Free**, deployment source **Other**:

- `worktrac-marketing-prod`
- `worktrac-marketing-lower`

Copy each deployment token into the deploy repo's secrets as
`SWA_DEPLOYMENT_TOKEN_MARKETING_PROD` / `SWA_DEPLOYMENT_TOKEN_MARKETING_LOWER`.
Note each `*.azurestaticapps.net` default hostname.

### 2. Bind the domains

| SWA | Domains | Free-tier slots |
|---|---|---|
| `worktrac-marketing-prod` | `huddle.fitness`, `www.huddle.fitness` | 2 / 2 |
| `worktrac-marketing-lower` | `dev.huddle.fitness` | 1 / 2 |

Apex domains on an external DNS provider validate by **TXT token first**; the
portal gives you the token when you add the domain. Subdomains validate by the
CNAME itself.

### 3. Namecheap → Advanced DNS for `huddle.fitness`

DNS is Namecheap BasicDNS (`dns1/dns2.registrar-servers.com`), not Azure DNS.

**Delete:**

- URL Redirect Record `@` → `https://app.huddle.fitness`
- URL Redirect Record `www` → `https://app.huddle.fitness`

**Add:**

| Host | Type | Value |
|---|---|---|
| `@` | TXT | *(validation token from the prod SWA's apex domain dialog)* |
| `@` | ALIAS | `<marketing-prod>.azurestaticapps.net` |
| `www` | CNAME | `<marketing-prod>.azurestaticapps.net` |
| `dev` | CNAME | `<marketing-lower>.azurestaticapps.net` |

Namecheap BasicDNS supports `ALIAS` at the apex. If it refuses, fall back to an
`A` record pointing at the SWA inbound IP shown in the portal.

**Leave untouched:** `app`, `app.dev`, the `asuid` TXT records, and every
ACS/SPF/DKIM record for `DoNotReply@huddle.fitness`.

**Order:** create the SWA, add the TXT, let Azure validate, *then* swap the
A/URL-forward records. Do `dev` first as a rehearsal — it has no existing record,
so there is nothing to break. Managed certificates take a few minutes after
validation.

`www` serves identical content to the apex, which is why the page carries
`<link rel="canonical" href="https://huddle.fitness/">`.

### 4. Deploy-repo jobs

Add to `deploy-lower.yml` (and the mirror in `deploy-prod.yml`, swapping
`lower` → `production` and the token name):

```yaml
  deploy-marketing-lower:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout deploy repo
        uses: actions/checkout@v7

      - name: Apply environment robots.txt
        run: cp config/lower/marketing-robots.txt marketing-build/robots.txt

      - name: Deploy marketing site to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.SWA_DEPLOYMENT_TOKEN_MARKETING_LOWER }}
          action: "upload"
          app_location: "marketing-build"
          skip_app_build: true
```

And the two robots files:

```
config/lower/marketing-robots.txt        →  User-agent: *
                                            Disallow: /

config/production/marketing-robots.txt   →  User-agent: *
                                            Allow: /

                                            Sitemap: https://huddle.fitness/sitemap.xml
```

## The product screenshots are real, and regenerating them is scripted

Every product image under `marketing/assets/shots/` (and the link preview, `assets/og-image-<yyyy-mm>.png`)
is a capture of the app actually running, no mockups. Since 2026-10-27 they all come from one
script and one household: the reviewer demo household (Alex, Sam and Jordan, written into the
production account by `e2e/tools/demo-household.mjs`). That is the same household the App Store
screenshots show, so the site and the listing tell one story, and nobody's real family is on a
public page. The earlier set mixed a real family's names across screenshots, a deadlift chart that
dived halfway across, and a household video whose still frame caught the app mid-save; the
on-device captures, the old video and the `marketing-capture.mjs` / `marketing-shots.mjs` pipeline
that went with them are gone.

```bash
cd e2e
FRONTEND=https://app.huddle.fitness EMAIL=... PASSWORD=... ALLOW_WRITES=1   node tools/marketing-demo-shots.mjs ../marketing/assets
```

The login is the reviewer account's (kept outside the repo; never commit it). What each scene
does:

- **`workout`** starts Alex's Squat Day routine on the tablet (the routine strip fills the
  landscape screen; starting one writes nothing), logs two squat sets for the hero pair and the log
  card (tablet and phone width), and waits out part of the rest timer. It refuses to start if
  Alex already has a workout going, and deletes exactly its own sets and ends the workout after,
  as `app-store-shots.mjs` does. **It writes to the account App Review signs in to**, so don't run
  it while a submission is in review: `SCENES=trends,offline,og` re-takes everything else without
  writing anything.
- **`trends`** captures Sam's squat chart and weekly workouts, card by card.
- **`offline`** logs two sets with the network cut and closes the browser before reconnecting, so
  they only ever exist in that throwaway profile. Light and dark, since the page swaps them with
  `<picture><source media="(prefers-color-scheme: dark)">`.
- **`og`** builds the 1200 x 630 link preview from the hero phone capture, framed in the hero's
  phone bezel (frame, status band, island) so the unfurl reads as a phone, not a floating card.
  It writes nothing to the account: `EMAIL=x PASSWORD=x SCENES=og` re-renders it from the
  `device-iphone.jpg` already on disk. **A changed preview gets a new filename** (the script's
  `OG_IMAGE`, and every page's `og:image` / `twitter:image`): iMessage, Signal and the like cache
  the unfurl by image URL, and the site serves assets with a week's `max-age`.

**Phone-width versions.** The log card, the celebration and both Trends cards are also captured at
440px wide (`...-phone.jpg`) and served on screens 700px and narrower through
`<picture><source media="(max-width: 700px)">`. A 1000px-wide capture shrunk into a phone's
column left 5px text, and phones are where most visitors arrive from. Each `<source>` declares its
own `width`/`height`.

Then update each `<img>`'s (and `<source>`'s) `width`/`height` in `index.html` to the new files.
`landing.spec.ts`'s "declared at its real shape" test fails on any image whose declared shape no
longer matches the file.

Things that cost a round trip when they were learned:

- **Sticky chrome paints over an element screenshot** of anything taller than the viewport, so the
  card scenes demote `sticky`/`fixed` to `static` first.
- **A pointer left over a chart leaves its hover tooltip in the shot.** The card scenes park the
  mouse at (0, 0).
- **The demo account is shared with App Review.** Its other people may have a workout going (a
  green dot on their pill) that the script did not start. Leave it alone: the cleanup only ever
  touches the sets this run logged for Alex.
- **Free shows 90 days**, so Trends' six-month consistency grid is mostly empty on the demo account.
  That is why the second Trends image is the weekly bars, not the grid.

### The household clip

"Everyone's in the huddle" plays nine seconds of the real app on a phone, in the hero's phone frame:
switch to Sam, "+" weight and "+" reps, Log set, the New PR! celebration, then her squat chart with
the set just logged as its new high. `e2e/tools/marketing-demo-clip.mjs` records and encodes it:

```bash
cd e2e
FRONTEND=https://app.huddle.fitness EMAIL=... PASSWORD=... ALLOW_WRITES=1   node tools/marketing-demo-clip.mjs <workDir> ../marketing/assets/shots
ENCODE_ONLY=1 node tools/marketing-demo-clip.mjs <workDir> ../marketing/assets/shots   # re-encode only
```

- **It logs one real set for Sam** and deletes exactly that set afterwards. It ends the workout only
  if it started one, because an open workout it found belongs to someone else (App Review uses
  this account). Not during a review.
- **A soft ring marks each tap**, like iOS's "Show touches". It is the only thing drawn over the
  app. It fades within about a third of a second, because "Nice" sits exactly where "Log set" was
  tapped, and a lingering ring read as a tap on Nice.
- **Recorded from Chrome's screencast**, frame by frame with timestamps, not Playwright's
  `recordVideo` (a fixed 1 Mbit/s that blurs text).
- **Encoded in Microsoft Edge**, whose H.264 output (what Safari and every iPhone need) is the
  one verified by playing it back, so there is no video tool to install. Running a downloaded
  encoder binary is blocked in this environment anyway. MP4 comes from Edge's **WebCodecs**
  encoder, packed by `e2e/tools/mp4-mux.mjs`. **Not Edge's MediaRecorder**: its MP4 froze between
  keyframes in playback, so a 9-second clip showed its first frame for 5 seconds. WebM (VP9) does
  come from MediaRecorder, which is fine for that format.
- **The page lists MP4 first and WebM second**, and the browser picks by `type`. `lazy-video.js`
  wires up every `<source>`, so that choice works. Reduced-motion visitors get the poster (the
  celebration) and no video bytes.
- **Check the encode by playing it, not by seeking.** Sample frames while it plays in Edge (which
  decodes H.264). The broken MediaRecorder MP4 reported the right duration and seeked without
  complaint.

### The hero's device frames

The hero pair are **full screens at real device proportions**, iPad Air 11" landscape (1180 x 820)
and a 6.9" iPhone (440 x 956), each captured at the scale that makes the file exactly the size the
markup declares, so nothing is resampled. The app's layout genuinely differs at those widths (the
log screen goes two-column on the tablet), and the CSS bezel takes its shape from the image, so a
crop of some other screen would show as the wrong device (`.claude/rules/marketing.md`).

The bezels themselves are **pure CSS** (`.device` in `styles.css`), with no chrome images to keep
in sync. The phone frame adds a **status-bar band** above the screenshot, in the app's own header
colour, for the dynamic island to sit in: a browser capture starts at the page content.

Below 700px the hero drops the tablet and keeps the phone: a tablet screenshot scaled to 390px is
unreadable, while a phone screenshot at phone size is exactly what a visitor on a phone is being
sold.

## Checking it locally

```bash
bash scripts/check-marketing.sh          # static checks; also runs in CI

cd marketing && python -m http.server 8099
cd e2e && npm ci
node tools/marketing-contrast.mjs        # WCAG AA audit, light + dark
node tools/marketing-screens.mjs <dir>   # screenshots + overflow/console check
```

Both tools accept `MARKETING_URL` to point at a deployed environment instead.

The contrast audit is not decoration: the first run caught six real failures,
including `--color-faint` used as body text (the app's own stylesheet says in a
comment that it is not a text colour) and a white label on `--color-accent`,
which is 3.62:1 and passes AA Large only.

## Design source

`marketing/design/` holds the Claude Design canvas artboards. They are the
design, not the site — see the README there. When they and the shipped page
disagree, the shipped page wins.
