---
paths:
  - "marketing/**"
  - "frontend/index.html"
  - "scripts/*site-origins*"
  - "scripts/preview-marketing.sh"
  - "e2e/marketing-tests/**"
---

# Each environment names only itself

Full narrative: `docs/marketing-site.md`, "Each environment names only itself".

The marketing site and `frontend/index.html` are built once and promoted unchanged from lower to
production, so **no file may hardcode an environment's address**. An absolute URL in deployed HTML
is written `__SITE_ORIGIN__/…` or `__APP_ORIGIN__/…`, and the robots meta says `__SITE_ROBOTS__`.
Every deploy, lower and production alike, runs `tools/fill-site-origins.sh` with its own
`config/<env>/site-origins.env` (in `worktrac-deploy`) before uploading, then
`tools/verify-site-origins.sh` on the live pages.

- **Link previews and crawlers never run a script**, which is why this is a deploy-time fill and not
  runtime JS (`app-links.js` did the CTAs that way and missed everything else) or `config.json`
  (right for what the app's JS reads, invisible to raw HTML). Lower shared with production's share
  image unfurled with no picture, because production didn't have that file yet (2026-10-29).
- **Never special-case one environment in the fill.** Production runs the same step as lower. A
  step only lower runs means lower tests something production skips.
- **A new placeholder needs three things together:** a line in `fill-site-origins.sh`'s `sed`, a
  key in BOTH deploy environments' `site-origins.env` and in `scripts/site-origins.local.env`, and
  the expected value in `e2e/marketing-tests/site-origins.ts`. The fill refuses to finish if any
  `__NAME__` survives, so missing the first fails loudly; `check-marketing.sh` check 14 catches it
  before merge.
- **The scripts ship with the release.** `promote-to-lower` copies them into the deploy repo's
  `tools/`, so the fill always matches the placeholders it fills. Don't keep a second copy in
  `worktrac-deploy`.
- **Never serve `marketing/` directly to test it.** Its pages hold placeholders. Use
  `bash scripts/preview-marketing.sh`, which fills a copy and serves it with a 128-connection
  queue. Plain `python -m http.server` queues 5 and Windows refuses the rest, which failed the
  16-worker marketing suite at random with `ERR_CONNECTION_REFUSED` (measured 2026-10-29: 6 of 9
  runs red, 0 of 8 with the bigger queue).
- **Email addresses (`support@huddle.fitness`) are not origins** and stay literal.
- **The App Store build is the one nobody fills.** `npm run build:native` ships `index.html`'s
  share tags as placeholders. That's harmless, since nothing reads Open Graph inside the app. Don't
  "fix" it by baking production's address back into the source.
- **The app's own JS still reads production's address in one place:** `LegalLinks.jsx`'s Terms and
  Privacy URLs. Those belong in `config.json` (the app's runtime config), not in this fill.
