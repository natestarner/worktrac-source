---
paths:
  - "backend/src/main/java/com/worktrac/backend/billing/**"
  - "frontend/src/components/billing/**"
  - "frontend/src/api/billing.js"
---

# Billing invariants

Full narrative: `docs/architecture/billing.md`. `accounts` is the billable entity — one household,
one login, many people, **no seats** — so there is exactly one `subscriptions` row per account,
enforced by a unique index (V56).

## Entitlement is DERIVED, never stored

`SubscriptionService.isPro` is the only place the question "is this household Pro?" is answered:

```
isPro = status ∈ { ACTIVE, TRIALING, PAST_DUE }
      OR (status == CANCELED AND current_period_end > now)
      OR comped
```

One expression gets four otherwise-separate cases right. **Do not replace it with an `is_pro`
column**, and do not let a caller compare statuses itself — each of these becomes a place to drift:

1. **PAST_DUE is still Pro.** Stripe is retrying the card; cutting access mid-dunning turns a
   recoverable payment failure into a cancellation.
2. **CANCELED is Pro until `current_period_end`.** They bought that period.
3. **Expiry happens by the clock**, so a cancelled household downgrades whether or not
   `subscription.deleted` ever arrives.
4. **`comped`** grants Pro with no Stripe object, so founding households need no second code path.

`subscriptions.billing_plan` is a materialized cache of the derivation, written only by
`applyStripeState` so the two cannot be set independently. `isPro` stays the authority.

**A missing subscription row means FREE, never an error.** Registration creates one and V56
backfilled the rest, so it should be unreachable — but a read of workout history must not fail
because billing has no opinion about that household yet.

## Clamping is server-side; the client's plan drives chrome only

`AccountDto.plan` reaches the browser and is persisted in the auth snapshot, which is what lets the
header render correctly on a cold offline boot. **The server never trusts it and never needs to** —
every gate reads the subscription row directly. That separation is what stops an unreachable server
from downgrading anyone, which is the `resilience.md` failure this feature is most likely to cause.

`PlanBadge` renders **nothing** for an unknown plan. An auth snapshot written before billing shipped
has no `plan` key, and showing "Go Pro" to someone who already pays is the worst outcome available
here. Absence is the safe default; it self-corrects on the next `/me`.

## No billing state may ever destroy workout data

The Free-tier window is a **read filter and nothing else**. The marketing site promises this in
writing twice ("Your workouts are never deleted on Free", "Nothing is deleted, ever"), so it is a
commitment rather than an implementation detail.

- The clamp belongs in the query layer, **never** in a migration, a scheduled job, or a delete path.
- Downgrading and re-upgrading must return the identical rows. A test that only checks "hidden when
  Free" would pass against an implementation that deleted them.
- **PR detection uses full history even on Free; only display is clamped.** Computing PR-ness
  against the visible window would congratulate someone for a record they did not set, and the
  celebration is the emotional core of this app. Note `log-screen.md` documents three PR predicates
  that are deliberately not unified — the clamp touches each differently.

## Reserved words: `billing_plan` and `billing_interval`

Both `PLAN` and `INTERVAL` are reserved in T-SQL, and an unbracketed one fails the migration
outright (`Incorrect syntax near the keyword 'plan'` — found by a real red build, not theory).
Prefixing beats bracketing: `[plan]` works in DDL but leaves every future hand-written query one
forgotten bracket from the same error.

## Stripe integration rules

- **`StripeService` is the only class that imports `com.stripe.*`**, the way `EmailService` isolates
  Azure Communication Services. That is what makes integration tests possible with `@MockitoBean`
  rather than an HTTP stub server — there is no WireMock in this repo, deliberately.
- **The client never sends a price ID.** It sends `MONTH`/`YEAR` and the backend maps it. Accepting
  a price id from a browser lets a caller check out against a price they invented.
- **Never trust an account id from a request body or webhook payload alone.** `CurrentUser` for
  authenticated calls; `metadata.accountId` plus a `stripe_customer_id` lookup for webhooks.
- **Stripe does not guarantee webhook ordering.** On any subscription-shaped event, re-fetch the
  subscription from Stripe and write *that* — never apply the delivered payload directly, or a
  stale `subscription.updated` overwrites a newer `subscription.created`. Re-fetching also makes a
  missed event self-heal on the next one.
- **V57's filtered unique index on `stripe_event_id` IS the idempotency mechanism.** Stripe
  redelivers events routinely; the duplicate insert failing is the dedup point
  (`BillingAuditService.recordIfFirstSeen`). Do not add a check-then-insert beside it — it has a
  race the index does not, and a second mechanism for one job is the bug.
- **Every billing endpoint must answer honestly when Stripe is unconfigured** — an explicit 503,
  never a 500 and never a silent "not Pro". Config is empty by default so an unconfigured
  environment rejects rather than defaults open, the same posture as `EMAIL_DELIVERY_WEBHOOK_KEY`.
- **Billing writes are Tier-3**: `useGatedMutation` + `OfflineDisabledWrap`, never the durable
  outbox. They are not idempotent, and a queued payment replayed across an outage is exactly what
  the outbox must never hold. `loadStripe()` is called lazily inside the gated action so an offline
  household never requests `js.stripe.com` and the app keeps no third-party boot dependency.
- **`PlanBadge`'s Free control is NOT `OfflineDisabledWrap`ped** — it is a navigation, not a write.
  Client-side routing works offline; the gate belongs on the checkout button it leads to.

## Deleting an account must stop the money

`AccountDeletionService` clears `billing_events` then `subscriptions` **before** `accounts` — the FK
is NO ACTION (V56), so a missed step fails the delete outright rather than orphaning a row. It must
also cancel the subscription at Stripe, or a deleted household keeps being charged.
`TestDataCleanupService` needs the same two tables in its bulk delete, or e2e cleanup starts failing
on constraint violations.

## Label collisions this feature creates

- Header badge is **"Go Pro"**; the billing screen's primary button is **"Upgrade to Pro"**. A Free
  household on `/app/billing` has both on screen, and a shared accessible name makes every
  Playwright `getByRole` on it a strict-mode violation. "Upgrade" alone would be worse — a substring
  of the other, matching both.
- **"Pro" is a substring of "Profile"**, `UserMenu`'s first item, in the same header subtree. Assert
  the badge with `exact: true` / an exact string, always.
