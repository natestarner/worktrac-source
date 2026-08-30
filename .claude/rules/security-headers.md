---
paths:
  - "frontend/public/staticwebapp.config.json"
  - "marketing/staticwebapp.config.json"
---

# Response-header invariants for the two Static Web Apps

Both origins ship security headers through their SWA config's `globalHeaders`. **Neither block
may be dropped, and the app's must never fall behind the marketing site's again** — for a while
the brochure site had `nosniff`, `Referrer-Policy` and HSTS while `app.huddle.fitness`, the origin
that actually holds the auth token, had no `globalHeaders` block at all.

## Why each one is there

| Header | What it stops |
|---|---|
| `X-Frame-Options: DENY` | Clickjacking. Every destructive action in the app — delete account, remove person, delete set, undo import — sits behind a confirm dialog that an attacker's page could otherwise overlay invisibly. |
| `X-Content-Type-Options: nosniff` | A response being re-interpreted as a type it did not declare. |
| `Strict-Transport-Security` | A first-visit downgrade to plaintext. |
| `Referrer-Policy: strict-origin-when-cross-origin` | Leaking in-app paths to third parties. |
| `Permissions-Policy` | Silently available device APIs the app never uses. **`payment=(self)` and not `()`** — Stripe's embedded checkout runs inside the app's own document, so denying payment outright breaks upgrading to Pro. |

## The token makes framing worse than it looks

The JWT lives in `localStorage` with a 30-day expiry and no revocation
(`frontend/src/api/client.js`). That is a deliberate trade for offline boot, but it means the
blast radius of anything that gets script or UI control of this origin is a month of full account
access — which is why the framing and content-type guards are not merely hygiene here.

## Content-Security-Policy

Set on the app origin. Each directive below is load-bearing; the three marked ⚠️ are the ones that
break the app rather than merely loosening it.

| Directive | Why |
|---|---|
| `frame-ancestors 'none'` | The modern clickjacking control. `X-Frame-Options: DENY` stays alongside it for older browsers. |
| `script-src 'self' https://js.stripe.com` | Stripe's embedded checkout loads its script from there. **No `'unsafe-inline'`** — that would give away most of what the policy buys. |
| ⚠️ `style-src 'self' 'unsafe-inline'` | Recharts and React inject inline `style` attributes. Without `'unsafe-inline'` every chart and most of the layout loses its styling. |
| ⚠️ `worker-src 'self'` | `vite-plugin-pwa` registers `/sw.js`. Without it the app loses offline mode entirely — the exact failure `resilience.md` exists to prevent. |
| ⚠️ `connect-src` incl. `https://*.azurecontainerapps.io` | The API origin is read at runtime from `/config.json` and **differs per environment**, so it cannot be a literal here. The wildcard covers both deployed backends. **If the API ever gets a custom domain, add it or every request fails.** |
| `frame-src https://js.stripe.com https://hooks.stripe.com` | Embedded checkout runs in an iframe from those origins. |
| `img-src` incl. `data:` and `blob:` | `data:` for inline icons; `blob:` because CSV/ZIP export builds an object URL. |
| `form-action 'self'`, `base-uri 'self'`, `object-src 'none'` | Standard hardening with no cost here — the app has no cross-origin form posts, no `<base>`, no plugins. |

The Customer Portal is a **redirect** to `billing.stripe.com` opened in a new tab, not a frame, so
it needs no `frame-src` entry — top-level navigation is not governed by these directives.

### Verifying a CSP change

It can white-screen the app, and local dev does not exercise the deployed origin split, so this
must be checked against a **deployed** environment:

1. Load the app with devtools open and confirm **zero** CSP violations across Log, Trends,
   History, Settings and Help.
2. Complete a **real Stripe checkout** — the embedded iframe and its script are the most likely
   thing to be blocked, and it is the one flow that costs money when it breaks.
3. **Cold-boot offline** and confirm the service worker still registers and `/app/help` resolves.
   `npm run test:pwa` covers the mechanics; the deployed check covers the policy.
4. Run the full e2e suite.

Ship a CSP change on its own, never bundled with unrelated work — otherwise a white screen is
ambiguous between the policy and everything else in the deploy.
