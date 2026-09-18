---
paths:
  - "backend/src/main/java/com/worktrac/backend/billing/**"
  - "frontend/src/components/billing/**"
  - "frontend/src/api/billing.js"
---

# Billing invariants

Full narrative: `docs/architecture/billing.md`. `accounts` is the billable entity — so there is
exactly one `subscriptions` row per account, enforced by a unique index (V56).

**Household tiers have no seats; Pro is licensed by client count.** That replaces the old "one
household, one login, many people, no seats" framing, which was true while every tier was a family
tier and is false now. It is a **replacement, not an exception**: Free and Plus still have no seats
at all, and their ceiling (`QuotaProperties.peoplePerAccount`, twenty) is still a statement about
what a family is rather than about what anybody paid for. Pro's ceiling is the band it bought. One
`subscriptions` row per account is unchanged — a band is a column on that row, not a second row.

## The tier roadmap, and why the paid tier is called Plus

Four tiers are planned. Two exist:

| Tier | Audience | State |
|---|---|---|
| **Free** | Families trying it out, training together on one shared device | Shipped |
| **Plus** | Families who want full history and a login each | Shipped |
| **Pro** | Personal trainers, with private client sub-accounts | Planned |
| **Team** | Sports teams and lifting clubs, with a leaderboard and coach approval | Planned |

**The paid tier was renamed Pro → Plus in #280 (`d71e614`) purely to free the name**, because
"Pro" is the natural word for the personal-trainer tier and could not mean two things. V73 carried
the data half of that rename and points here for the reasoning; this section is that reasoning.

⚠️ **Anything still spelled `pro` in this codebase means PLUS, and is a bug to be fixed rather
than a tier to build on.** The rename was behaviourally complete and lexically incomplete, and the
stragglers were cleared separately: `PRO_BENEFITS` → `PLUS_BENEFITS`,
`BillingEventType.PRO_WELCOME_EMAIL_*` → `PLUS_WELCOME_EMAIL_*` (persisted values, hence V74),
`ImportController.requirePro` → `requirePlus`, and `SubscriptionDto.pro`, which was **deleted**
rather than renamed — it carried the same answer as `plan` in a second shape.

**The seams the two planned tiers are built on already exist, and each was left deliberately
inert.** Do not "finish" any of them opportunistically; each is switched on by the tier that needs
it, together with the copy and the tests that make it true:

- `accounts.members_see_everyone` (V66) — owner-sees-all vs member-sees-only-self. Forced `true`
  for Free/Plus **by construction**, because a family expects it. Pro is what adds the setter and
  the endpoint; a private client is a `MEMBER` in an account where this is `false`.
- `AccountRole.permissions(membersSeeEveryone)` — the only place in the codebase a role becomes
  authority, which is what makes a third role a change to one map rather than to 36 guard sites.
- `QuotaProperties.peoplePerAccount = 20` — a hard ceiling that blocks a roster outright, left
  unraised on purpose so "a team is just a big family" cannot ship by accident.

## ⚠️ Ask for a FEATURE, never for a tier

`isPlus` used to be a boolean answering what is now a four-way question, asked at eleven call
sites — each one a place a third tier could be forgotten. It is gone, split into the two questions
it was conflating:

| Question | Answered by |
|---|---|
| Is this subscription currently **paying**? | `SubscriptionService.isEntitled` — the four-case derivation below, unchanged |
| **Which tier** is this household on? | `SubscriptionService.entitledPlan` = `isEntitled ? the tier the row records : FREE` |
| Does that tier **include X**? | `BillingPlan.features()`, reached through `SubscriptionService.has(accountId, PlanFeature)` |

**`BillingPlan.features()` is the only place in the codebase that branches on a tier**, exactly as
`AccountRole.permissions()` is the only place that branches on a role. A second
`plan == BillingPlan.PRO` comparison anywhere is the bug, for the same reason a second
`role == OWNER` is — that map is what makes adding Pro and Team a change to one file rather than
to every gate.

- **`PlanFeature.DATA_IMPORT` and `Permission.IMPORT_DATA` are different questions and are spelled
  differently on purpose.** The permission asks *may this LOGIN import*; the feature asks *does this
  household's PLAN include importing*. `ImportController` checks both. Naming them the same thing
  would invite collapsing them, and they are not collapsible: an owner on Free holds the permission
  and lacks the feature; a member on Plus is the reverse.
- **FREE's feature set is EMPTY, not a subset of PLUS.** Everything Free actually gets — unlimited
  workouts, every person, offline logging, PRs, routines, the full data export — is ungated, so
  none of it is a `PlanFeature`. Several are promised in writing on the marketing site for *both*
  plans; listing them here would invite gating one.
- **An entitled row that records no tier resolves to the LOWEST PAID tier, never FREE.** Only a
  hand-edited row reaches that branch (`applyStripeState` writes entitlement and tier together),
  but the polarity matters: somebody demonstrably paying must not be clamped, and guessing upward
  would hand out a tier nobody bought.
- **The client has its own copy** — `frontend/src/utils/planFeatures.js` — because the same
  question was being asked as a bare `plan !== 'FREE'` at five call sites. It drives chrome only,
  and `PlanFeatureMappingTest` / `planFeatures.test.js` pin the two maps to the same answers.
- **⚠️ THE TIER COMES FROM THE PRICE.** `applyStripeState` maps `state.stripePriceId()` back through
  `StripeProperties.skuForPriceId`, because the price is the only thing in a Stripe payload that
  says which tier was bought. An `isEntitled ? PLUS : FREE` here would silently write PLUS over a
  Pro subscription on the very next webhook.
  - **An unrecognised price KEEPS the tier the row already had** — it is a config gap on our side
    (an env var not carried to this environment), not evidence about what the household bought.
    Downgrading a paying trainer over a missing env var would re-inflict itself on every webhook
    until somebody noticed. The watchdog re-applies once the mapping exists.
  - **Seats travel with the tier**, written in the same place, because a band change *is* a price
    change and two writers for one fact is how they drift.

## Pro: bands, seats and the price matrix

- **`PlanSku` is the catalogue** — one constant per (plan, band, interval) we sell, and **the enum
  name IS the config key** (`app.stripe.prices.PRO_STUDIO_YEAR`). Renaming a constant is a config
  change in three places (repo secrets, the deploy workflow's env block, `backend-env.json`). It is
  an enum rather than a formatting function because the **reverse** lookup has to be total: a
  webhook carries a price id and nothing else that names a tier.
- **The client still never sends a price id.** It sends plan + band + interval; the server maps
  them. A combination we do not sell — FREE, PLUS *with* a band, PRO *without* one — has no
  constant, so it is a 400 rather than a checkout against the wrong price.
- **`isConfigured()` no longer asks about prices, and `sells(plan)` is per-tier.** "Can we reach
  Stripe" and "do we sell this here" are different questions: an environment legitimately has Plus
  prices and no Pro ones for the whole length of a tier rollout, and conflating them meant one
  missing Pro env var would have switched off **Plus** checkout. A tier this environment cannot
  sell answers **503**, the same honest-refusal posture as an unconfigured environment.
- **A blank env var is how an unset one arrives.** `${STRIPE_PRICE_PRO_X:}` binds to `""`, not to
  absent, so blank must count as unconfigured — otherwise every environment claims it sells
  everything.
- **⚠️ A BAND IS A CEILING ON ADDING, NEVER A REVOCATION.** `client_seats` is consulted only before
  a person is created. Moving *down* a band refuses the next client and touches nothing that
  already exists — every client keeps their login, history and programs. Same promise the Plus
  pause makes, and it is not negotiable here either: a billing change must never cost somebody
  *else* their access.
- **The trainer does not spend a client seat on themselves.** The person ceiling is
  `clientSeats + 1`, because a trainer who also trains must not pay to log their own squats.
- **UNLIMITED still has a number** (`peoplePerProAccount`). "Unlimited" is a pricing promise, not
  an invitation to create rows without bound. `clientLimit()` is **null** rather than a sentinel,
  because "unlimited" and "a very large number" read the same in a comparison and completely
  differently in copy — a sentinel would make *"12 of 2147483647 clients"* a reachable string.
- **`comped_plan` says WHICH tier a comp grants, and null means PLUS.** That is what every comp
  meant before Pro existed, which is why V75 needed no backfill. It is separate from `billing_plan`
  because that column is a cache `applyStripeState` rewrites on every Stripe event, while a comp is
  a standing grant meant to outlive exactly that — folding them together would let a webhook about
  a lapsed card overwrite the comp.
- **Seats are reported only while the tier is in force.** A lapsed Pro row still records the band it
  bought; `entitlementOf` and `SubscriptionDto` both clear seats once the tier reads FREE, or a Free
  account would be told it has a roster allowance it is not paying for.
- **`SubscriptionDto.clientCount` is the "12" in "12 of 15 clients" — USAGE, computed fresh in
  `SubscriptionService.describe`, never stored.** It is `people on the account, minus the trainer's
  own person, minus every MANAGER's own person` — neither spends a client seat
  (`QuotaService.requirePersonCapacity`'s `clientSeats + 1` ceiling for the trainer), so neither
  should count as one on the billing screen either. Clamped to `null` alongside `clientSeats` for
  every non-PRO tier, for the same reason: a household tier has no seats to report usage against.
- **`SubscriptionService` takes `StripeProperties`, not `StripeService`.** It depends on the price
  *configuration*, never on the SDK — `StripeService` is still the only class importing
  `com.stripe.*`, and this is what keeps `applyStripeState` unit-testable with a plain properties
  object and no HTTP stub.

### The unknown-plan polarity, and why the client has two of them

A browser keeps its auth snapshot across deploys (`resilience.md` axis D), so a bundle **will** be
handed a tier name it predates. The client answers that in two different directions, and both are
deliberate:

| Helper | Unknown NAME (`'PRO'`) | No plan at all (`undefined`) | Why |
|---|---|---|---|
| `planIncludes` | included | included | Fails OPEN. Being wrong costs one doomed round trip the server refuses with a message; being wrong the other way tells a paying household they are on Free for as long as the tab stays open |
| `isPaidPlan` | paid | **not paid** | Every tier after FREE is paid, so a newer name is paid. But *no plan* is not a plan to call paid — `BillingTab` picks between the "you have Plus" summary and the "here is what Plus costs" one on this, and answering true would show the paid summary to somebody who never paid and hide the control that lets them |
| `isKnownPlan` | not known | not known | The one "render nothing" case. `PlanBadge` NAMES the plan on screen and there is no safe way to name one you do not recognise |

## Comps are granted from the ADMIN PORTAL, not from config

`CompGrantService` is the **only production writer** of `comped` / `comped_plan`
(`TestSupportController` is its `@Profile`-gated twin). `COMPED_EMAILS` and `CompBootstrap` are
retired — existing comped households were unaffected, because a comp was always a row rather than
a value computed from the list at boot. Full reasoning, including why this reversed a documented
decision: `docs/architecture/billing.md`. Endpoint invariants: `.claude/rules/admin-portal.md`.

- **⚠️ A comp does not stop the money.** Granting one to a household with a live Stripe
  subscription is refused (409), or they keep paying for a plan they were just given.
- **⚠️ No `PlusUpgradedEvent` for a comp.** Its copy presumes a purchase. `AccountPlanChangedEvent`
  *is* published, and `CompGrantService` is `@Transactional` so the `AFTER_COMMIT` listener
  actually fires — do not copy `TestSupportController`'s direct `invalidateAccount` call, which
  exists only because that handler is not transactional.
- **Revoke recomputes rather than clamping to FREE**, since a household can hold a comp *and* a
  paying Stripe subscription. Clamping would cut off somebody who is actually paying.
- **`comp_note` (V80) is the REASON only.** Who granted it and when are audit facts and live in
  `billing_events`; a mutable column on the subscription row is the wrong place for one.

## Entitlement is DERIVED, never stored

`SubscriptionService.isEntitled` is the only place the question "is this subscription currently
paying?" is answered:

```
isEntitled = status ∈ { ACTIVE, TRIALING, PAST_DUE }
          OR (status == CANCELED AND current_period_end > now)
          OR comped
```

One expression gets four otherwise-separate cases right. **Do not replace it with an `is_plus`
column**, and do not let a caller compare statuses itself — each of these becomes a place to drift:

1. **PAST_DUE is still Plus.** Stripe is retrying the card; cutting access mid-dunning turns a
   recoverable payment failure into a cancellation.
2. **CANCELED is Plus until `current_period_end`.** They bought that period.
3. **Expiry happens by the clock**, so a cancelled household downgrades whether or not
   `subscription.deleted` ever arrives.
4. **`comped`** grants a paid tier with no Stripe object, so a comped household needs no second
   code path anywhere downstream.

`isEntitled` is now literally `comped || isPayingThroughStripe(subscription)`. **That split is a
NAMED sub-question, not a second derivation** — cases 1-3 live in `isPayingThroughStripe` and
nowhere else. It exists because `CompGrantService` must ask "is this household paying us through
Stripe *right now*?", which `isEntitled` cannot answer: it returns true for an already-comped row.
Do not inline the status comparisons at a call site.

`subscriptions.billing_plan` is a materialized cache of the derivation, written by `applyStripeState`
and `CompGrantService` — always together with the tier it caches, never independently.
`entitledPlan` stays the authority.

**A missing subscription row means FREE, never an error.** Registration creates one and V56
backfilled the rest, so it should be unreachable — but a read of workout history must not fail
because billing has no opinion about that household yet.

## Clamping is server-side; the client's plan drives chrome only

`AccountDto.plan` reaches the browser and is persisted in the auth snapshot, which is what lets the
header render correctly on a cold offline boot. **The server never trusts it and never needs to** —
every gate reads the subscription row directly. That separation is what stops an unreachable server
from downgrading anyone, which is the `resilience.md` failure this feature is most likely to cause.

`PlanBadge` renders **nothing** for an unknown plan. An auth snapshot written before billing shipped
has no `plan` key, and showing "Go Plus" to someone who already pays is the worst outcome available
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

## The window must SAY it is clamping

A clamped screen that looks complete is the bug this feature exists to fix: a Free household could
log a past workout months back, tap Done, and land on History reading *"No workouts logged yet"* —
about a workout the app had just saved.

- **The server answers "is anything hidden from you"; the client never computes the window.**
  `GET /api/people/{id}/history-window` → `HistoryWindowDto(windowStart, hiddenSessions,
  earliestHiddenAt)`. A client-side "90 days" would be a second copy of `FREE_HISTORY_WINDOW`, free
  to drift from the clamp it describes — so even the copy derives its number from `windowStart`
  (`historyWindowCopy.js`). `windowStart` is non-null for **every** Free household, including one
  with nothing hidden yet; that is what lets `PastSessionModal` warn *before* the workout is logged.
- **`hiddenSessions` counts only pre-window sessions that have sets**, matching `getHistory`'s own
  filter exactly, so the number is precisely how many History rows are missing. An honest count is
  the entire justification for showing one.
- **Say what the person HAS, never what the app is withholding.** "Your full history has 47 more
  workouts" — not "47 workouts are hidden on Free", which was the first draft and casts the app as
  the thing keeping someone from their own training. That is the wrong posture for a product whose
  central promise is that it never deletes anything, and the invitation belongs to the "See Plus"
  link beside the sentence rather than to the sentence. Pinned in `historyWindowCopy.test.js`.

  **This governs EVERY surface, not just that one sentence.** It was written for
  `historyWindowCopy.js` and then not applied anywhere else, so the handbook still said *"workouts
  older than 90 days are hidden, not removed"* and the Terms and Privacy pages both said *"hidden
  from view"* — the app describing itself as concealing someone's own training, on the two pages
  that exist to promise the opposite.

  The frame that works everywhere: **a plan decides what a screen SHOWS; it never decides what
  exists.** Prefer "History, PRs and Trends show the last 90 days" over any construction where the
  app is the subject doing something to the data. "Hidden", "withheld", "locked", "restricted" and
  "removed from view" all fail this; "shows", "covers", "still saved" and "on screen again" pass.
  The one-line form is *"Your history never changes; only how much of it is on screen does."*

  **The `hiddenSessions` / `earliestHiddenAt` DTO fields are exempt and stay as they are** — they
  are engineering vocabulary on an internal contract, never rendered. This rule is about copy a
  person reads, and renaming an accurate field would be churn across the backend, the client and
  the specs for no reader's benefit. Just never let the field name leak into a sentence.
- **The notice carries no mark; the explainer's benefits block does.** See "The mark names the
  PRODUCT" below for the convention and why the sentence about someone's own data is excluded.
- **`HistoryWindowNotice` is the one way any screen says this**, and it composes `PlusUpsell` rather
  than replacing it, so "one way to ask for an upgrade" still holds. Three fail-closed gates:
  unknown plan, unanswered query, or a zero count all render **nothing** — which is why a Free
  household inside the window sees no change anywhere in the app.
- **`PastSessionModal` warns, it does not block.** No `min` on the date input and no disabled
  button: the workout genuinely is saved and returns on upgrade, so refusing it would turn a display
  limit into a data-entry limit and contradict "nothing is deleted, ever".
- **`HistoryWindowModal` is a modal, and `PlusUpsell`'s header says never to use one.** The
  distinction is solicited vs unsolicited — that rule forbids an upgrade prompt that *interrupts*.
  This one only ever opens from an explicit tap on "About your full history". Nothing may be
  changed to open it automatically.
- **This adds no connectivity branch**, so nothing about it belongs on `resilience.md`'s register.
  `historyWindow` is in `offlineCacheWarm.js` (`refreshAfterRestore: true` — the server wholly owns
  it), so the notice reads identically in every mode; `parity-…`-style coverage is in
  `free-window-notice.spec.ts`. Dropping it from the warm makes the three tabs look **complete**
  while offline, which is the divergence the contract forbids outright.
- **`hasAnyHistory` must stay pre-clamp.** See `trends.md`.

## The mark names the PRODUCT, not the entitlement

`HuddleMark` leads every phrase that names Huddle Plus as a product, on **both** plans:
`PlanBadge`'s two pills, `BillingTab`'s "Huddle Plus" plan heading, `PlusCelebration`, and
`HistoryWindowModal`'s benefits block. So "Go Plus" reads as *go Huddle Plus* rather than as a generic
upsell.

This **supersedes** an earlier reading in which the mark meant "you have Plus" and Free households
got an aspirational outline star instead. The star is gone. What signals possession now is the
**pill**, not the glyph — `.plan-badge--plus`'s fixed bright identity colours against
`.plan-badge--upgrade`'s transparent outline.

Where it does **not** go, and each exclusion is load-bearing:

- **Inside a control label** — "Upgrade to Plus", "See Plus". A four-colour glyph inside a filled
  primary button or a small text link is clutter, and "logo Plus" only parses as a unit when *Plus*
  opens the phrase. `PlanBadge`'s pills are the exception because a badge **is** a brand chip.
- **In handbook prose.** `HelpTab` says "Plus" dozens of times mid-sentence; marks there would be
  confetti, and `getByText` concatenates only DIRECT text children (`frontend-core.md`).
- **On a sentence that doesn't name Plus.** `HistoryWindowNotice`'s line is about the person's own
  data; a mark on it is decoration, and decoration is how a quiet inline note starts reading as an
  ad — the one thing `PlusUpsell` exists to prevent.

**No image wordmark.** "Plus" is nearly always a word inside a label, so an image would break the
accessible names the non-containment rule depends on, could not inherit the app's font/size/colour,
and would reintroduce the hardcoded light/dark hairline `HuddleMark` was drawn inline to escape.
`docs/brand/README.md` also forbids respacing the lockup, so a real "Huddle Plus" lockup has to come
from the brand kit rather than being assembled here. Compose it from `HuddleMark` + live text. An
asset is only the answer for surfaces that cannot compose — email (hence `public/email/logo.png`),
marketing, social cards.

**Hairline**: pass `hairline="#bdb6af"` only where the ground stays light in **both** schemes —
today just `.plan-badge--plus`. Every other caller sits on a theme-following surface and takes the
default. `HuddleMark` is always `aria-hidden`, so it never touches the accessible name beside it,
which is what keeps the non-containment rule intact.

## The welcome-to-Plus email fires exactly once, ever

`Subscription.plusWelcomeSentAt` (V72) is the idempotency mechanism, not the `wasPlus`/`nowPlus`
comparison beside it in `applyStripeState` — that comparison is exactly the one
`AccountPlanChangedEvent`'s own javadoc explains why it avoids computing (getting it subtly wrong
fails silently). Here it is worth doing anyway because the failure mode is a missed or duplicated
welcome email rather than a minute of stale cache, and the null-checked column is what keeps a
wrong comparison from ever double-sending: the email only goes out while the column is still null,
regardless of how many times `applyStripeState` runs for the same household afterward (a renewal,
a redelivered webhook, the reconciliation watchdog self-healing a missed one).

- **`PlusUpgradedEvent` is published from `applyStripeState` only on that first transition** — never
  for a comp grant (`CompGrantService`). A comped household was never charged, and the email's copy
  ("thanks for keeping Huddle going") presumes a purchase just happened.
- **`PlusUpgradeEmailEventListener` records outcomes to `billing_events`**, not the registration
  audit trail, even though it is structurally the same "send after commit, off the request thread,
  record either way" shape as `RegistrationEmailEventListener` — same reasoning as
  `ContactEmailEventListener` being its own component: the natural audit sink here is
  account-keyed, and `billing_events` already is.

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
  never a 500 and never a silent "not Plus". Config is empty by default so an unconfigured
  environment rejects rather than defaults open, the same posture as `EMAIL_DELIVERY_WEBHOOK_KEY`.
- **Billing writes are Tier-3**: `useGatedMutation` + `OfflineDisabledWrap`, never the durable
  outbox. They are not idempotent, and a queued payment replayed across an outage is exactly what
  the outbox must never hold. `loadStripe()` is called lazily inside the gated action so an offline
  household never requests `js.stripe.com` and the app keeps no third-party boot dependency.
- **`PlanBadge`'s Free control is NOT `OfflineDisabledWrap`ped** — it is a navigation, not a write.
  Client-side routing works offline; the gate belongs on the checkout button it leads to. Both
  plan states are links now (Plus badge included, since paying earns a piece of chrome that
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

- Header badge is **"Go Plus"**; the billing screen's primary button is **"Upgrade to Plus"**. A Free
  household on `/app/billing` has both on screen, and a shared accessible name makes every
  Playwright `getByRole` on it a strict-mode violation. "Upgrade" alone would be worse — a substring
  of the other, matching both.
- The window notice adds three more, and all six have to stay mutually non-containing:
  `PlusUpsell`'s **"See Plus"**, the notice's **"About your full history"**, and — inside
  `HistoryWindowModal`, which opens with the notice and the header badge both still in the DOM —
  **"Unlock full history"** and **"How Free and Plus differ"**, alongside `Modal`'s own **"Close"**.
  Note "About your full history" and "Unlock full history" share the words *full history* without
  either containing the other, which is what the rule actually requires. Pinned in
  `HistoryWindowNotice.test.jsx`.
- **"Plus" is a substring of "Profile"**, `UserMenu`'s first item, in the same header subtree. Assert
  the badge with `exact: true` / an exact string, always.

## ⚠️ A plan decides what a SCREEN shows — and, separately, what a LOGIN can do

The line above ("a plan decides what a screen SHOWS, never what exists") was written about **data**,
and it is still exactly true: no workout is hidden, moved or deleted by a downgrade, and Free's
history window is a read filter over rows that are all still there.

**Do not reuse that phrasing for member logins.** From phase 8 a plan genuinely decides what a
LOGIN can do: a MEMBER in a household that is not Plus has `MembershipStatus.PAUSED_PLAN` and is
refused on every route but `GET /api/auth/me` and `GET /api/billing/subscription`. That is a real
capability gate, not a display rule, and describing it with the data sentence would make one of the
two claims false.

What the two DO share, and what must stay true of both:

- **Nothing is deleted, and nothing is revoked.** The person, their history, their PRs and their
  membership row all survive a downgrade untouched. Re-upgrading restores the login with no
  re-invitation — that is why the block is a status rather than a membership deletion.
- **Queued work is suspended, never discarded.** The 403 carries the code `MEMBER_LOGIN_PAUSED`
  precisely so `isDeadWrite` can tell it apart from an ordinary definitive 403; without that
  carve-out a paused member is told the sets they logged before the lapse can never sync.
- **An OWNER is never paused.** They are the only one who can return the household to Plus, so
  pausing them would lock everybody out of the screen that undoes it.
