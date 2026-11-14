# In-App Purchase plan

**STATUS (2026-11-14): DESIGN AGREED, not started.** All decisions made (see "Decided"). Building
waits on Nate's go-ahead; Phase 0 setup in App Store Connect can start now. Apple's reply to the
1.2.0 (build 24) appeal is still pending. If Apple accepts the appeal, this is still the long-term fix, but it
stops being urgent.

## Why

App Review rejected 1.2.0 under guideline 3.1.1. The app lets people use Plus and Pro bought on the
web (Stripe), and those plans can't also be bought in the app through Apple. The reviewer saw the
US link-out working exactly as designed and rejected it anyway. Apple's reading: a US app *may*
link out, but anything you can use in the app must *also* be for sale through In-App Purchase
(3.1.3(b), which has no US exception).

## The design in one paragraph

**The app sells through Apple. The web sells through Stripe. A household is billed by exactly one
of them at a time.** Apple becomes a second writer of the household's existing `subscription` row
(plan, status, interval, band, period end), plus a new `billing_source` column (`STRIPE` or
`APPLE`). Everything downstream already derives what a household gets from that row
(`SubscriptionService.entitledPlan`, `BillingPlan.features()`), so no gate, screen or feature check
needs to know Apple exists. A household that pays Apple has Plus on the web, on every device and
for every member, the same as a Stripe household.

## Simplicity decisions (each one trades a little money or reach for less to build)

| Decision | Simple choice | What it costs |
|---|---|---|
| How to talk to Apple | **Directly**: a small StoreKit 2 plugin of our own in the app (like the existing Storefront and review-prompt plugins), and Apple's official `app-store-server-library` on the backend. No RevenueCat. | About a day or two more to build than a vendor SDK. In exchange: no vendor holding purchase data, no privacy-policy change, no fee, no third service that can be down. Android (Google Play) will be its own piece of work when it comes. |
| What to sell | **All ten SKUs** (Plus monthly/yearly, four Pro bands x two intervals) in **one subscription group** | Apple takes 15% on Pro bought in the app. Pro buyers can still choose the web. One group means Apple handles Plus to Pro and band changes itself, prorated, and guarantees one Apple subscription per person. |
| The US link-out | **Remove it from the app.** The app has one way to buy: Apple. | US buyers in the app pay through Apple (15%) instead of Stripe. Deletes the hosted-checkout, pending-checkout and resume code from the app path. |
| Prices | Nearest Apple price point to each web price (e.g. $29/yr becomes $29.99) | Pennies. Not raising Apple prices to cover the 15% keeps one price story; we can revisit. |
| Family Sharing | **Off** on every product | Nothing. Huddle already shares across the household by itself. |
| Free trials / offers | **None** | Nothing new to build. |
| Outside the US | Stays US-only | Nothing now; IAP makes other countries possible later. |

## No overlapping subscriptions: how it's guaranteed

Nobody should ever pay Stripe and Apple at once. Four rules, in order of how often they matter:

1. **Each side refuses to sell to a household the other side is billing.**
   - Web checkout already refuses any household that's entitled (`BillingController.prepareCheckout`,
     "This account already has a paid plan."). An Apple household is entitled, so this works with
     no change. Its Billing tab says "Your plan is billed through the App Store" with instructions
     to manage it in iPhone Settings, and shows no Stripe buttons.
   - The app asks the backend before opening Apple's purchase sheet
     (`POST /api/billing/apple/prepare`). A Stripe-billed or comped household is refused. Its
     Billing tab says "Your plan is billed on huddle.fitness" with a manage link (allowed in the US)
     and shows no Apple buttons.
   - "Still billed" includes cancelled-but-paid-through, Stripe past-due and Apple's grace and
     billing-retry periods. Switching sides means cancelling and waiting for the period to end.
2. **Changing plans stays on the same side.** An Apple household changes tier or band through
   Apple (same subscription group, so Apple prorates). A Stripe household uses the Customer Portal
   as today.
3. **Safety net for a race** (buying on the web and in the app within seconds of each other). We
   can cancel and refund Stripe; we can't cancel Apple. So if an Apple purchase lands on a household
   with a live Stripe subscription, the backend **cancels the Stripe subscription immediately with
   a prorated refund**, records it in `billing_events`, and emails the owner. Apple wins, always.
4. **An Apple purchase belongs to the household that made it.** Every purchase carries StoreKit's
   `appAccountToken`, a random per-household UUID the backend hands out in `/apple/prepare` (new
   column). Apple stamps it into the signed transaction, so the backend knows which household paid
   without any Apple ID mapping. A transaction stamped for a different household is never applied
   here, so Restore Purchases re-syncs this household and never moves a subscription to whichever
   household is signed in.

**Deleting an account** with an Apple subscription can't cancel it (only the person can). The
delete flow tells them to cancel in iPhone Settings, as Apple requires, and the backend logs it.

## Phases

### Phase 0: Nate, in App Store Connect (about an hour, plus Apple's wait)
- Sign the **Paid Applications Agreement** and add bank and tax details (IAP is blocked until this
  is active; Apple can take a day or more).
- Enroll in the **App Store Small Business Program** (15% instead of 30%).
- Create one subscription group and the ten products (ids like `huddle.plus.year`,
  `huddle.pro.studio.month`), Family Sharing off, prices at the nearest points.
- Create a sandbox tester.
- Create an **In-App Purchase API key** (Users and Access, Integrations) for the App Store Server
  API. Secrets go in with `gh secret set` (paste-ready block from Claude): the `.p8` key, its key
  id, the issuer id.
- Set **App Store Server Notifications (Version 2)** URLs: production to `api.huddle.fitness`,
  sandbox to lower's `api.dev.huddle.fitness`.

### Phase 1: Backend (about 4 to 5 days)
- Migration: `billing_source`, `app_account_token` (the household's random UUID),
  `apple_original_transaction_id`, `apple_product_id`.
- `AppleBillingService`, the only class that imports Apple's `app-store-server-library`, like
  `StripeService` for Stripe. It verifies Apple's signed data against Apple's root certificates
  (bundled) and calls the App Store Server API.
- `POST /api/billing/apple/notifications`: Apple's server notifications. Each one is verified, then
  used only to know *which* subscription changed; the service **pulls** that subscription's current
  status from Apple (Get All Subscription Statuses) and writes the row. Duplicate, late or
  out-of-order notifications therefore can't corrupt it, the same way the Stripe watchdog
  re-reads Stripe. Product id maps to `PlanSku`.
- `POST /api/billing/apple/prepare` (the refusal in rule 1; returns the `appAccountToken`) and
  `POST /api/billing/apple/sync` (the app sends the signed transaction right after a purchase or
  restore; the backend verifies it and pulls status, so the plan updates without waiting for
  Apple's notification).
- Refunds and revocations (`REFUND`, `REVOKE`) end the plan immediately; expiry, grace period and
  billing retry map onto the existing statuses so `entitledPlan` treats them like Stripe's
  canceled-until-period-end and past-due.
- The race safety net (rule 3), reusing `StripeSubscriptionCanceller`.
- `billing_events` rows for Apple purchases, renewals, expiries, refunds and safety-net cancels.
- The reconciliation watchdog checks Apple households too.
- Tests for every case in the overlap section.

### Phase 2: App and web (about 4 days)
- A `Purchases` StoreKit 2 plugin (`ios/App/App/`, next to `StorefrontPlugin.swift`): load the
  ten products, `purchase(productId, appAccountToken)`, a `Transaction.updates` listener started at
  launch (renewals and purchases that finish while the app is closed or after Ask to Buy / SCA),
  `finish()` each transaction only after `/apple/sync` succeeds, `AppStore.sync()` for Restore, and
  Apple's manage-subscriptions sheet for changing or cancelling.
- `billingChannel` becomes `embedded` (web) or `apple` (App Store app). `external` goes away.
- App Billing tab: the same plan cards, buying through Apple. Plus a **Restore Purchases** button
  and the price, period and Terms/Privacy links Apple requires.
- The two "billed elsewhere" states on both sides (rule 1).
- Purchases need a connection, like checkout today (`useGatedMutation`). After a purchase the app
  shows "Confirming your purchase..." until `/apple/sync` answers, and re-syncs when it comes back
  to the foreground.
- Account deletion wording for Apple households.
- Unit tests, web e2e for the Apple-billed household (seeded), and the parity rules from
  `.claude/rules/resilience.md`.

### Phase 3: Prove it on lower (about 2 days)
A StoreKit configuration file lets the simulator buy all ten products with no network, for fast
local checks. Then a TestFlight build of Huddle Lower with sandbox purchases: buy Plus, upgrade to Pro, change band,
cancel and let it expire (sandbox renews monthly in 5 minutes), refund, restore on a second device,
and the race between web and app. Each must land in exactly one billing source.

### Phase 4: Submit 1.3.0
The first products must be submitted together with the build. Update the review notes, and add the
standard Apple subscription terms (EULA) link to the listing. The privacy policy needs no new
vendor; check that it says purchases in the app go through Apple.

**Total: about 2 weeks of build and test, plus Apple's agreement and review waits.**

## Decided
- **Apple directly, no RevenueCat** (Nate, 2026-11-14).
- **One way to pay in the app: Apple.** The US link-out to Stripe is removed from the app, along
  with its hosted-checkout, pending-checkout and resume code on the app path (Nate, 2026-11-14).
  The web keeps Stripe unchanged. A Stripe-billed household still gets a manage link on huddle.fitness
  from the app's Billing tab, but no way to start a new web purchase from the app.
- **Pro is sold in the app too**: all ten SKUs, one subscription group (Nate, 2026-11-14).
- **Same prices as the web, rounded to Apple's nearest price point** (e.g. $29/yr becomes $29.99),
  not raised to cover Apple's 15% (Nate, 2026-11-14).

No decisions are open. **Do not start building until Nate says go.**
