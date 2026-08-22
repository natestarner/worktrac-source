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

Every product image under `marketing/assets/shots/` is a screenshot of the app actually
running — no mockups, no drawn approximations. That is a deliberate constraint: a hand-drawn
"screenshot" drifts from the product the moment either changes, and it always looks like
what it is.

Two scripts in `e2e/tools/` do it, and they need this worktree's stack up:

```bash
bash scripts/up.sh

cd e2e && npm ci
# 1. Seed a household -- 3 people, 15 weeks, ~850 sets. Sessions-per-week varies (mostly 3,
#    some 2 and 4, one 5) on shifting weekdays, and the weights stall once and deload once,
#    so the charts look like training rather than a generated ramp. Prints the login.
FRONTEND=http://localhost:3003 node tools/marketing-capture.mjs

# 2. Screenshot the running app, light and dark.
FRONTEND=http://localhost:3003 EMAIL=<email from step 1> node tools/marketing-shots.mjs ../marketing/assets/shots
SCHEME=dark FRONTEND=http://localhost:3003 EMAIL=<same> node tools/marketing-shots.mjs ../marketing/assets/shots
```

Things that cost a round trip when they were learned:

- **The Trends charts are not built on the shared `Card` primitive** — each is a plain div with
  inline surface/border/radius styles. `marketing-shots.mjs` anchors on the heading text and
  walks up two levels rather than looking for `.card`.
- **Sticky chrome paints over an element screenshot** of anything taller than the viewport:
  Playwright scrolls the element into view and the sticky layer follows it down. The script
  demotes `sticky`/`fixed` to `static` for the capture.
- **The offline shot is genuinely offline** — the script cuts the network, logs two real sets,
  and captures the app's own "2 changes waiting to sync" banner. It is deliberately a viewport
  capture rather than an element crop, because that banner lives in the chrome above
  `.tab-panel`.
- **Seed before the app loads, not after.** `offlineCacheWarm` caches whatever it finds, so data
  inserted behind a running app's back leaves sections blank for about a minute.
- **Anchor sessions to real Mondays, not to rolling 7-day blocks counted back from now.** The
  workouts-per-week chart bins by calendar week, so rolling blocks bleed across boundaries and
  flatten the intended 2/3/4/5 distribution into a near-constant 3.
- **End the session the script starts.** The offline step leaves a live session behind; on the
  next run the Log tab then opens to the picker instead of the exercise, which silently turned
  the hero's log screenshot into a picture of the exercise list.

Each shot is captured at `deviceScaleFactor: 2` and downscaled by the `width`/`height`
attributes on the `<img>`, so it stays sharp on a retina display. Light and dark are separate
files, swapped with `<picture><source media="(prefers-color-scheme: dark)">` — the same
mechanism the app uses for its logo.

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
