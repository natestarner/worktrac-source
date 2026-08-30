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

Not yet set. When it is added, three things will break it if they are missed:

- **`worker-src 'self'`** — `vite-plugin-pwa` registers `/sw.js`. Without it the app loses offline
  mode entirely, which is the exact failure `resilience.md` exists to prevent.
- **`style-src` needs `'unsafe-inline'`** — Recharts and React inject inline `style` attributes.
  `script-src` must **not** have it.
- **`connect-src` must include the backend API origin**, which differs per environment, so it
  needs the same per-environment treatment the deploy repo already applies to `config.json`.

The only external origins the app references are Stripe (`js.stripe.com`, `api.stripe.com`,
`hooks.stripe.com`, and `billing.stripe.com` for the portal redirect). There are no web fonts and
no CDN assets — keep it that way, or the policy grows.

**A CSP change must be verified against a deployed environment**, with the full e2e suite plus
`npm run test:pwa` and a real Stripe checkout. One that passes local dev and breaks checkout in
production is the specific risk.
