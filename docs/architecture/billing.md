# Billing: plans, entitlement, and Stripe

Invariants: `.claude/rules/billing.md`. This file is the reasoning behind them.

## What Pro is

`huddle.fitness` sells Pro at $3.99/month or $29/year. Pro buys two things:

- **History, PRs and trends with no 90-day window.**
- **Importing past workouts.**

Everything else is free forever, **including full data export on both plans**. That last one is a
deliberate reversal of an earlier draft, and it removed more than it added: no self-serve
GDPR/CCPA gap, no admin export endpoint to make a privacy-policy commitment keepable, and no second
entitlement predicate (`canExport`) diverging from `isPro`. Export mainly appeals to people who
intend to leave, and gating the exit is the weakest thing to charge for. It also resolved a latent
contradiction — `HelpTab.jsx` already tells people to "export your data first" before deleting an
account, advice that would have been impossible to follow for exactly the Free users most likely to
be deleting.

## Why entitlement is derived rather than stored

The obvious design is an `is_pro` column. It is wrong in four separate ways, and the derivation in
`SubscriptionService.isPro` gets all four right in one expression — see the rule file for the
enumeration. The short version: entitlement is a function of *status and time*, and any stored copy
of it is stale the moment the clock moves.

The most consequential of the four is that **expiry happens by the clock, not by a webhook**. A
cancelled household stops being Pro when its paid period ends whether or not Stripe's
`subscription.deleted` ever arrives. That removes an entire class of "the webhook was missed and
now the data is wrong" bug — for cancellations. It does *not* cover an `ACTIVE` subscription whose
deletion event never arrives, which is why `SubscriptionReconciliationWatchdog` exists: the same
"an async mechanism must never make 'it didn't run' indistinguishable from 'it ran fine'" rule the
email pipeline already follows (`.claude/rules/registration-and-email.md`).

`billing_plan` on the row is a materialized cache of the derivation, written only by
`applyStripeState`. It exists so the admin list and `AccountDto` do not each recompute across every
account; it is never the authority.

## Why the Stripe Customer is created lazily, at first checkout

Not at registration. A Stripe outage during signup would be catastrophic and completely outside the
user's control; the same outage during an upgrade is a visible, retryable error on a gated write.
`RegistrationService.createAccountUserPerson` therefore writes a local FREE subscription row and
talks to nobody. It also runs inside `confirmEmail`'s `@Transactional(noRollbackFor = ...)`, which
is another reason to keep a network call out of it.

## Why the success screen does not wait for the webhook

Stripe's embedded Checkout returns the browser to `/app/billing?checkout=cs_...`. The backend reads
*that session* from Stripe directly and reconciles synchronously, so the upgrade is visible
immediately. The webhook is the backstop, not the critical path — which avoids the classic "I paid
and I'm still on Free" support ticket entirely.

Both paths call the same `applyStripeState`. Two callers, one writer, so the immediate path and the
asynchronous one cannot disagree about what a given Stripe state means.

## Why webhooks re-fetch instead of applying their payload

**Stripe does not guarantee event ordering.** `customer.subscription.updated` can arrive before
`customer.subscription.created`, so applying delivered payloads directly lets a stale event
overwrite newer state — a bug that would appear only under load and only sometimes. Re-fetching the
subscription by id and writing the current state makes ordering irrelevant, and makes a missed event
self-heal on the next one. This is the highest-value correctness decision in the integration.

Idempotency comes from V57's filtered unique index on `stripe_event_id` rather than a
check-then-insert: Stripe redelivers routinely, and the constraint violation *is* the "already seen"
signal, with no race of its own.

## Why embedded Checkout rather than a redirect

Both are Stripe-hosted and both keep the integration in PCI SAQ-A — no card data reaches this code.
The deciding factor is that Huddle is an **installed PWA** on iPhone and iPad, where a cross-origin
`window.location` out of a standalone app can hand the user to Safari and not reliably hand them
back. Someone tapping "Upgrade" mid-workout could end up stranded outside the app they just paid
for. Embedded Checkout renders in an iframe on `app.huddle.fitness`, inside the app's own chrome.

The hosted **Customer Portal** (cancel, update card, invoices, switch interval) is redirect-only —
no embedded variant exists — so it opens in a new tab, leaving the PWA's document alive behind it.

`loadStripe()` is called lazily inside the gated action rather than at module scope, so an offline
household never requests `js.stripe.com` and the app keeps no third-party dependency on its boot
path.

## The degraded-conditions story

Billing writes are Tier-3: `useGatedMutation` + `OfflineDisabledWrap`, never the durable outbox.
That is the *existing* register row in `.claude/rules/resilience.md` — a payment is not idempotent,
and a queued one replayed across an outage is precisely what the outbox must never hold.

The **read** is the harder half, and it is answered structurally rather than defensively:

- **Clamping happens server-side.** The client's `account.plan` drives chrome only. A household
  that cannot reach the server still sees the right plan, because the answer never depended on the
  request succeeding — and `offlineCacheWarm` warms whatever the server already clamped, so a Free
  household's cached history looks identical online and off.
- **A former Pro who downgrades keeps a fuller cache until it refetches.** That is leniency in the
  safe direction. Do not add a cache purge on downgrade: stale-toward-Pro costs nothing, while
  stale-toward-Free locks someone out of what they paid for — the exact "degraded ⇒ blank" outcome
  the contract forbids.
- **An unknown plan renders nothing**, rather than guessing Free. See `PlanBadge`.

## The welcome-modal deferral

A household arriving from marketing's "Go Pro" is routed to `/app/billing` after confirming their
email, and the first-run welcome modal is suppressed until that decision resolves — a tour
interrupting someone mid-purchase is the wrong order.

The durable flag (`lib/onboardingPending.js`) is untouched. It answers "has this account been
onboarded yet" — durable, one-shot, account-scoped. The deferral answers "not right now", which is a
different question with a different lifetime, so it lives in `UIContext` beside `tour`, in memory.

Losing it to a reload is deliberate: the modal then appears on the next boot, whereas persisting the
deferral risks a stale one suppressing the welcome modal permanently. `ProductTour.jsx` gives the
same reasoning for refusing to persist its own `stepIndex`.

`BillingTab` releases on unmount, which covers every exit — paying, "Start with Free", or simply
leaving via a tab — with one mechanism rather than three call sites.

## Existing households when the window lands

Clipped like everyone else, except a comped list. `comped` ships as a column in V56, but the list
itself is **`COMPED_EMAILS`, not a migration** — reusing the `ADMIN_EMAILS` mechanism exactly
(typed properties plus an `ApplicationRunner`) rather than inventing a second way to grant
something from a configured list.

Two reasons it is not a migration, and the first is the important one:

- **These are other people's personal email addresses.** A migration writes them into git history
  permanently, in a repository that has no business holding them. An env var sourced from a deploy
  secret keeps them out of both repos.
- Comping someone later would otherwise need a new migration each time. This makes it a config
  change, which is what it actually is.

`CompBootstrap` is **promote-only**, and that asymmetry is deliberate. `AuthService.login` both
promotes and demotes admins because losing an admin role costs someone a menu item. Losing a comp
costs them their entire training history behind a paywall, with no warning and no purchase to point
at — far too consequential to happen as a side effect of an edited environment variable, or of a
deploy where the secret was momentarily unset. A household that drops off the list is **logged, not
revoked**.

Rejected: Stripe 100%-off promotion codes. They work (`duration: forever` plus
`payment_method_collection: 'if_required'` so a $0 total does not demand a card), but for a handful
of known households they are strictly more moving parts — a code to distribute, a checkout to
complete, and an expiry to forget. Also rejected: a "comp this account" admin button, which would be
a third sanctioned write action in a deliberately read-only portal.


## Saying what the window is hiding

The clamp shipped correct and silent, and silent was the bug. Two shapes of it:

- **The acute one.** A Free household taps "+ Log a past workout", picks a date months back, logs
  the sets, taps Done — and lands on History reading *"No workouts logged yet."* The work is saved
  and returns with Pro, but the app has just told them it does not exist. `log-past-workout.spec.ts`
  flagged this in a comment and worked around it by forcing the household to Pro.
- **The chronic one.** Any Free household past ~90 days of use. History simply ends, the PR board
  can be missing whole exercises, and the Trends range toggle offers "All" while the charts cover 90
  days. Nothing on screen said so.

### The server answers "is anything hidden from you"

`GET /api/people/{id}/history-window` returns `windowStart`, `hiddenSessions` and
`earliestHiddenAt`. It is its own endpoint rather than an envelope on `/history` for two reasons:
all three clamped screens ask the same question and only one of them reads the history list, and
widening `/history` from a bare array to an object would break every persisted query cache written
by an older build — the axis-D case in `resilience.md`.

Pro short-circuits with no query at all (a null floor means nothing is filtered, so there is nothing
to count). Free runs one `COUNT` + `MIN` aggregate with an `EXISTS` sub-select — never a second
full-history load, which `trends.md` forbids outright.

**The client never computes the window**, not even for copy: `historyWindowCopy.js` derives "the
last 90 days" from the `windowStart` the server reported. A literal 90 on the client would be a
second copy of `FREE_HISTORY_WINDOW`, and the copy is the half nobody would think to update.

### Why the count, and not just "Free shows 90 days"

The number is the person's own data, which makes it simultaneously the most honest framing and the
strongest argument. "Your full history has 47 more workouts" is a fact about them; "Free shows the
last 90 days" is a policy, and a reader cannot tell whether it covers two workouts or two hundred.

The **voice** took a second pass. The first draft read "47 earlier workouts are saved but hidden on
Free", which is accurate and still wrong: it casts the app as the thing standing between someone and
their own training, in a product whose central promise is that it never deletes anything. Naming the
data as theirs — and leaving the invitation to the "See Pro" link beside it — says the same thing
without the app taking the role of gatekeeper. `historyWindowCopy.test.js` pins the posture, not
just the string.

### What the mark means

A second pass settled this too, and it moved the meaning of the mark itself.

It used to signal **entitlement**: `PlanBadge` gave a paying household the four circles and a Free
household an outline star — "aspirational, not achieved". That reads fine in the header and nowhere
else, because every other place the product is named ("Huddle Pro" on the billing screen, the
celebration, an upsell's benefits list) is talking about the *product*, not about who owns it.

So the mark now names the product, on both plans, and possession is carried by the **pill** instead:
`.plan-badge--pro`'s fixed bright identity colours against `.plan-badge--upgrade`'s transparent
outline. "Go Pro" reads as *go Huddle Pro*.

The exclusions are where the convention earns its keep. Not inside a control label — "logo Pro" only
parses as a unit when *Pro* opens the phrase, and a four-colour glyph inside a filled primary button
is clutter. Not in handbook prose, which says "Pro" dozens of times mid-sentence. And not on
`HistoryWindowNotice`'s line, which names the person's own data rather than the product: a mark
there is decoration, and decoration is how a quiet inline note starts reading as an advertisement.

**Not an image wordmark**, either. "Pro" is nearly always a word inside a label, so an image would
break the accessible names the non-containment rule depends on, could not inherit the app's font,
size or colour, and would reintroduce exactly the hardcoded light/dark hairline that `HuddleMark`
was redrawn inline to escape. The brand sheet also forbids respacing the lockup, so a genuine
"Huddle Pro" lockup would have to come from the kit. An asset is the right answer only for surfaces
that cannot compose one — email, marketing, social cards. That is also why `hiddenSessions` applies exactly the same "has sets" filter
`getHistory` does — an inflated count would be worse than no count.

### Warn, don't block

`PastSessionModal` shows the warning inline the moment an out-of-window date is picked, and does
**not** put a `min` on the input or disable the button. The workout genuinely is saved and comes
back on upgrade; refusing it would turn a display limit into a data-entry limit, which contradicts
the promise the marketing site makes twice in writing. The person is told before they spend five
minutes entering sets, and History explains itself afterwards — one coherent story either side of
the flow.

### Honest first, persuasive second

`HistoryWindowModal` leads with the reassurance ("Nothing is deleted, ever") before any pitch,
because someone who has just found data missing from their own screen needs *did I lose it?*
answered first. It then names two things a less honest version would omit: PR detection has been
reading the whole history all along, so their celebrations were real; and export is free on both
plans, so the data is retrievable regardless. An upgrade taken on a complete picture is the only
kind worth having, and both facts are already true — they simply were not being said.

### What keeps it from being an ad

It renders only when it is stating a fact about that household's own data. Unknown plan, unanswered
query, or a zero count each render nothing, so the majority of Free households — anyone inside their
first 90 days — see no change anywhere in the app. It is not dismissible, which is the accepted
trade: for a long-tenured Free household the statement stays true, so it stays on screen, and that
is why it is one line rather than a card. A dismiss would need a new persisted per-person field with
the hydrate-path hazard every one of those carries.


## Deploying it: the environment variables

All of these live in the separate **`worktrac-deploy`** repo, never here. Three places have to
agree, which is the same shape `ADMIN_EMAILS` and `ACS_EMAIL_CONNECTION_STRING` already have:

1. **Repo secrets** on `natestarner/worktrac-deploy`.
2. The **`az containerapp update --set-env-vars`** block in `deploy-lower.yml` and
   `deploy-prod.yml`.
3. **`config/{lower,production}/backend-env.json`** — the documentation mirror, using the existing
   `"SET_VIA_SECRET"` marker.

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_` in lower, `sk_live_` in prod. A real credential in both |
| `STRIPE_PUBLISHABLE_KEY` | Not secret — it is handed to the browser — but kept alongside the rest |
| `STRIPE_WEBHOOK_SECRET` | `whsec_` from the **Dashboard endpoint** for that environment. Local development uses the different one `stripe listen` mints |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | Price ids differ between sandbox and live |
| `STRIPE_RETURN_URL` | `https://app.dev.huddle.fitness/app/billing` / `https://app.huddle.fitness/app/billing` |
| `COMPED_EMAILS` | Comma-separated. **Set it as a SECRET, not a plaintext workflow value** — these are other people's personal addresses, unlike `ADMIN_EMAILS`' single team address |

```bash
gh secret set STRIPE_SECRET_KEY_LOWER      --repo natestarner/worktrac-deploy
gh secret set STRIPE_PUBLISHABLE_KEY_LOWER --repo natestarner/worktrac-deploy
gh secret set STRIPE_WEBHOOK_SECRET_LOWER  --repo natestarner/worktrac-deploy
gh secret set STRIPE_PRICE_MONTHLY_LOWER   --repo natestarner/worktrac-deploy
gh secret set STRIPE_PRICE_YEARLY_LOWER    --repo natestarner/worktrac-deploy
gh secret set COMPED_EMAILS                --repo natestarner/worktrac-deploy
# ...and the _PROD counterparts when production is ready.
```

**Nothing changes in `worktrac-source`'s `ci.yml`.** The Playwright suite needs no Stripe
credentials in any environment — see `TestSupportController`'s billing-plan route for why.

### Order of operations, and the one way to get it wrong

Merging to `main` deploys to **lower** automatically; production is a separate, manual push to the
deploy repo's `production` branch. That asymmetry is what makes the sequencing safe — but it also
makes exactly one mistake possible:

> **Never promote to production before the prod Stripe configuration is live there.** The gates and
> the billing screen ship together, so a production deploy with Stripe unconfigured leaves real
> households clipped to 90 days with a billing screen that answers 503. Set the prod secrets,
> create the live-mode product, prices, portal and webhook endpoint, and only then promote.

An unconfigured environment fails safe in the sense that matters — it refuses rather than granting
Pro to everyone — but "fails safe" is not the same as "is fine", and this is the one combination
worth checking by hand before pushing to `production`.
