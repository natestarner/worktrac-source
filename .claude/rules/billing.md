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
  Client-side routing works offline; the gate belongs on the checkout button it leads to. Both
  plan states are links now (Pro badge included, since paying earns a piece of chrome that
  actually goes somewhere) — neither is `OfflineDisabledWrap`ped, same reasoning either way.
- **`BillingTab`'s checkout-reconcile effect (`?checkout=cs_...`) must NOT use a `cancelled` flag
  from a cleanup closure to guard its success path.** React.StrictMode double-invokes this effect
  (mount → cleanup → mount) in local dev, and a real network round trip always outlasts that
  synchronous cycle — so a `cancelled` flag set by the first invocation's cleanup is **already
  true** by the time that same invocation's `reconcileCheckout()` resolves, silently discarding
  `refreshPeople`/`invalidateQueries`/the celebration/the URL cleanup on every single real
  checkout in local dev. The reconcile itself still lands and gets applied server-side (confirmed
  against `billing_events` — a genuine `CHECKOUT_RECONCILED` row with nothing shown for it), which
  is what makes this read as "the upgrade worked, no celebration" rather than an outright
  failure — costly to trace back to StrictMode for exactly that reason. `reconciledRef` already
  fully owns "should a new reconcile dispatch" (set synchronously before the async call), so there
  is nothing left for a second cancellation guard to protect against; removing it is the fix, not
  a workaround. **Not reproducible in Vitest/jsdom** — measured directly that RTL's render does not
  reproduce React's real double-invoke timing for this effect regardless of how the mock's promise
  is scheduled (tried a real `setTimeout`-deferred mock explicitly wrapped in `<StrictMode>`; only
  one invocation ever fired). The regression guard lives in `e2e/tests/billing.spec.ts` instead,
  against the real dev server.

## Deleting an account must stop the money

`AccountDeletionService` clears `contact_messages`, then `subscriptions`, then `billing_events`
**before** `accounts` — `contact_messages` and `subscriptions` both hold NO ACTION FKs (V56), so a
missed step fails the delete outright rather than orphaning a row. `TestDataCleanupService` needs
the same tables in its bulk delete, or e2e cleanup starts failing on constraint violations.

Cancelling the subscription at Stripe is **not** inline in this method — `StripeSubscriptionCanceller`
reads the pending subscription id before the deletes, then cancels in an `afterCommit` hook, after
`billing_events` is already gone. That ordering is load-bearing (a cancellation failure is recorded
as a `BillingEvent`, and clearing that table first would delete the only record of a needed manual
cleanup) — see the comments on `AccountDeletionService` and `StripeSubscriptionCanceller` for the
full reasoning; don't move it back in front of the deletes.

## Label collisions this feature creates

- Header badge is **"Go Pro"**; the billing screen's primary button is **"Upgrade to Pro"**. A Free
  household on `/app/billing` has both on screen, and a shared accessible name makes every
  Playwright `getByRole` on it a strict-mode violation. "Upgrade" alone would be worse — a substring
  of the other, matching both.
- **"Pro" is a substring of "Profile"**, `UserMenu`'s first item, in the same header subtree. Assert
  the badge with `exact: true` / an exact string, always.
