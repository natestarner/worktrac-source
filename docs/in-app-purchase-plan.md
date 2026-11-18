# In-App Purchase plan

**STATUS (2026-11-18): PHASES 1 AND 2 ARE ON LOWER** (#547, with worktrac-deploy #90 giving lower
its App Store settings). **App Store Connect is set up for both apps** ("Phase 0 progress
(2026-11-18)"), except Pro Unlimited Yearly's price and production's review screenshots. A Huddle
Lower 1.3.0 TestFlight build is next; **Phase 3** (real sandbox purchases on it) is what's left
before production. Production's backend config is worktrac-deploy #91 (draft, waiting on the
`APPLE_IAP_PRIVATE_KEY_PROD` secret). Apple requires In-App Purchase (2026-11-16); it ships in 1.3.0.
What the build could not prove without Apple is listed under "Not yet proven".

## Why

App Review rejected 1.2.0 under guideline 3.1.1. The app lets people use Plus and Pro bought on the
web (Stripe), and those plans can't also be bought in the app through Apple. The reviewer's
screenshot shows they saw the US link-out Billing screen working exactly as designed, and rejected
it anyway. Apple's reading: a US app *may* link out, but anything you can use in the app must *also*
be for sale through In-App Purchase (3.1.3(b), which has no US exception).

## The design in one paragraph

**In an app, you pay the app's store. On the web, you pay Stripe. A household is billed by exactly
one of them at a time.** Every store is just another writer of the household's existing
`subscription` row (plan, status, interval, band, period end), tagged with a `billing_source`
(`STRIPE`, `APP_STORE`, `GOOGLE_PLAY`). Everything downstream already derives what a household gets
from that row (`SubscriptionService.entitledPlan`, `BillingPlan.features()`), so no gate, screen or
feature check needs to know which store, or that stores exist. A household that pays Apple has Plus
on the web, on every device and for every member, exactly like a Stripe household.

## Decided

| Decision | Choice | What it costs |
|---|---|---|
| How to talk to Apple | **Directly**: our own small StoreKit 2 plugin in the app, Apple's official Java library (`com.apple.itunes.storekit:app-store-server-library`) on the backend. No RevenueCat. | A day or two more than a vendor SDK. No vendor holding purchase data, no fee, no third service that can be down. |
| Ways to pay in the app | **One: the app's store.** The US link-out to Stripe is removed from the app. | US buyers in the app pay through Apple (15%) instead of Stripe. |
| What to sell | **All ten SKUs**, Plus and every Pro band, in **one subscription group**. | Apple's 15% on Pro bought in the app; Pro buyers can still choose the web. |
| Prices | Same as the web, rounded to Apple's nearest price point (e.g. $29/yr becomes $29.99). | Pennies. The app shows the store's own price string, so our code never holds an Apple price. |
| Family Sharing, free trials, offers, promoted purchases | **All off.** | Nothing. Huddle already shares across the household. Off also guarantees every purchase starts inside our app (see rule 4). |
| Android | **Designed in now, built later.** Every shared piece is store-neutral; Android adds only its own provider and plugin (see "Android later"). | Nothing extra now beyond naming things "store" instead of "Apple". |

## No overlapping subscriptions: how it's guaranteed

Nobody should ever pay two places at once. We can cancel and refund **Stripe** (and Google), but we
**cannot cancel an Apple subscription**: only the person can. So the design never lets a second
subscription start, and when a race slips through anyway, the one we can't cancel is the one that
stays.

1. **Each side refuses to sell to a household someone else is billing.**
   - Web checkout already refuses any entitled household (`BillingController.prepareCheckout`:
     "This account already has a paid plan."). A store-billed household is entitled, so this needs
     no change. Its Billing tab says "Your plan is billed through the App Store" and how to manage
     it on the device; no Stripe buttons.
   - The app asks the backend before opening the store's purchase sheet
     (`POST /api/billing/store/{source}/prepare`). A household that is entitled through anything
     else (Stripe, a comp, a different store) is refused. Its Billing tab says "Your plan is billed
     on huddle.fitness. Sign in there to change it." in plain text, **with no link**: no link means
     no storefront rules to obey, in the US or anywhere else.
   - "Still billed" includes cancelled-but-paid-through, Stripe past-due and the store's grace
     period. Switching sides means cancelling and waiting for the paid period to end.
   - Only a login with `MANAGE_BILLING` (the owner) may prepare a purchase, exactly as for Stripe.
2. **Only one purchase at a time per household.** `prepare` atomically claims the household for 10
   minutes (`store_purchase_started_at`, a conditional `UPDATE`). A second device asking meanwhile is
   told "A purchase is already in progress on another device." The claim clears when the purchase
   is confirmed, when the person cancels the sheet (the app calls `release`), or after 10 minutes.
   This is what stops two parents' iPhones, on two Apple IDs, both buying in the same minute: the one
   overlap we could never undo.
3. **Changing plans stays on the same side.** An App Store household upgrades, changes band or
   switches monthly/yearly by buying another product in the same subscription group: Apple replaces
   the old one (upgrades immediately and prorated, downgrades at renewal). Never two subscriptions.
   A Stripe household uses the Customer Portal as today.
4. **Every store purchase is stamped with the household that made it.** `prepare` returns the
   household's `store_account_token` (a random UUID, created once per household). The app passes it
   to StoreKit as `appAccountToken`; Apple signs it into the transaction and keeps it on every
   renewal. The backend finds the household by the subscription id it already knows first, then by
   that token; it never trusts "whoever is signed in". Restore Purchases therefore re-syncs the right
   household and can never move a subscription to whichever household is signed in on that phone.
   If a transaction ever arrives with no token (only possible for a purchase started outside the
   app, which rule "promoted purchases off" prevents), it is not applied: it is logged to
   `billing_events`, and Apple's Set App Account Token endpoint can stamp it once someone checks.
5. **Safety net when both are live anyway** (e.g. a web checkout opened before an Apple purchase
   and finished after it, or an Ask to Buy request a parent approves days after subscribing on the
   web). The single writer applies one rule: **a subscription we can't cancel beats one we can.**
   The cancellable one (Stripe today, Google later) is cancelled immediately and its most recent
   payment refunded in full, the owner is emailed, and `billing_events` records it. Refunding the
   whole latest payment, not a prorated slice, is the simple choice: at most one period's money.
   Two Apple subscriptions on different Apple IDs can't both be cancelled by us; rule 2 makes that
   all but impossible, and if it happens anyway an ops alert fires and the owner is emailed which
   one to cancel in Settings.

**Deleting an account** cancels Stripe as today. An App Store subscription can't be cancelled by us,
so the delete screen tells the person to cancel it in Settings, as Apple requires, and
`billing_events` records that it was left running.

**Late or out-of-order messages can't do damage.** Every store message only says *which*
subscription changed; the backend then asks the store for that subscription's current state and
writes that. A message about a subscription that is no longer the household's current one can only
be applied if it is a paying state, and then rule 5 decides.

## How Apple's states map onto the row we already have

Turn on **Billing Grace Period (16 days)** in App Store Connect. Then the mapping reuses the Stripe
semantics `isEntitled` already implements, with no new status:

| Apple says | `status` | `current_period_end` | `cancel_at_period_end` | Entitled? |
|---|---|---|---|---|
| Active, auto-renew on | `ACTIVE` | expires date | false | yes |
| Active, auto-renew off | `ACTIVE` | expires date | true | yes, until it ends |
| In billing grace period | `PAST_DUE` | grace period end | false | yes (like Stripe retrying a card) |
| Billing retry after grace | `CANCELED` | expires date (past) | false | no, until Apple recovers it |
| Expired | `CANCELED` | expires date | false | no |
| Revoked (refund) | `CANCELED` | revocation date | false | no, immediately |

The tier and seats come from the product id (product id -> `PlanSku`). An unknown product id keeps
the tier the row already had, the same rule `applyPurchasedTier` uses for an unknown Stripe price.
An `ACTIVE` or `PAST_DUE` row whose end date has passed is re-checked with the store by the existing
hourly reconciliation watchdog, which now asks the row's own provider instead of always Stripe.

## Architecture

### Backend: one shared core, one provider per store

```
billing/store/
  StoreBillingProvider        interface: what every store must do (below)
  StoreSubscriptionState      record: source, subscription id, product id, sku, status, interval,
                              period end, cancelAtPeriodEnd, environment, account token
  StoreBillingController      /api/billing/store/{source}/prepare | release | sync
                              /api/webhooks/store/{source}       (no auth: the provider verifies)
  appstore/AppStoreProvider   the ONLY class that imports com.apple.itunes.storekit.*
  (later) googleplay/GooglePlayProvider
```

`StoreBillingProvider`:
- `source()`: `APP_STORE`, later `GOOGLE_PLAY`.
- `verifyPurchase(proof)`: turns what the app sends after a purchase or restore into a verified
  subscription reference (Apple: the transaction's signed JWS; Google: the purchase token).
- `parseNotification(headers, body)`: verifies a store message and says which subscription changed
  (Apple: signed notification V2; Google: Pub/Sub push with its OIDC token).
- `fetchState(reference)`: the store's current truth for that subscription (Apple: Get All
  Subscription Statuses; Google: `subscriptionsv2.get`).
- `canCancel()` / `cancelAndRefund(reference)`: Apple `false`; Google `true`. Used by rule 5 and by
  account deletion.
- `acknowledge(reference)`: Apple nothing; Google acknowledges within its 3-day window.

Shared, store-neutral pieces:
- **`SubscriptionService.applyStoreState`**, the single writer for store rows, beside
  `applyStripeState`. It writes the same columns, publishes the same `AccountPlanChangedEvent` and
  `PlusUpgradedEvent` (so member logins unpause and the welcome email sends exactly as for Stripe),
  and applies rule 5. `applyStripeState` gains rule 5's mirror: a Stripe subscription that turns up
  while a store is billing the household is cancelled and refunded instead of written.
- `isPayingThroughStripe` becomes **`isPaying`**: it only ever read `status` and
  `current_period_end`, which every source writes. `CompGrantService.blockedByStripe` becomes
  "billed by anyone" so a comp still can't be stacked on a paying household.
- **Product ids derive from `PlanSku`**: `<prefix>` + the SKU in lower case with dots, e.g.
  `huddle.plus.year`, `huddle.pro.studio.month`. The prefix is per environment
  (`huddle.` for Huddle, `huddle.lower.` for Huddle Lower), so ids are unique however Apple or Google
  scopes them and no per-product config exists to drift. Both stores accept lower case, digits and
  dots.
- **Both store environments are accepted everywhere.** TestFlight and App Review purchases are
  sandbox purchases, even against the production app and backend, and App Review must see Plus
  unlock or it rejects the build. The backend verifies each message with the verifier for the
  environment it names, stores `store_environment`, and the admin view shows it. A sandbox
  subscription renews every few minutes for about an hour and then expires, so a reviewer's Plus
  goes away by itself.
- Configuration: Apple's In-App Purchase key (`.p8`), key id, issuer id, bundle id and the app's
  Apple ID per environment, in the same three places billing config lives today. Apple's root
  certificate (`AppleRootCA-G3.cer`, valid to 2039) is bundled in resources.

Migration (one file): on `subscriptions`, add `billing_source NVARCHAR(20) NULL`,
`store_account_token UNIQUEIDENTIFIER NULL` (unique where not null), `store_subscription_id
NVARCHAR(512) NULL` (indexed; 512 because Google tokens are long), `store_product_id NVARCHAR(100)
NULL`, `store_environment NVARCHAR(20) NULL`, `store_purchase_started_at DATETIME2 NULL`. Backfill
`billing_source = 'STRIPE'` where `stripe_subscription_id IS NOT NULL`. New `BillingEventType`s:
`STORE_PURCHASE_STARTED`, `STORE_APPLIED`, `STORE_REJECTED`, `STORE_UNMATCHED`,
`OVERLAP_STRIPE_REFUNDED`, `OVERLAP_UNCANCELLABLE`, `STORE_LEFT_RUNNING_ON_DELETION`.

### App: one JavaScript interface, one plugin per platform

`lib/native/purchases.js` is the only place the app talks to a store, with the same five calls on
every platform:
- `getProducts(productIds)`: the store's own title, price string and period for each.
- `purchase({ productId, accountToken })`: resolves `purchased` (with a proof), `pending` (Ask to
  Buy or bank approval, which finishes later) or `cancelled`.
- `restore()`: proofs for every current subscription.
- `manageSubscriptions()`: opens the store's own manage/cancel screen.
- `finish(proof)` and a `transaction` listener: purchases that complete while the app is closed,
  renewals, and pending ones that are approved later.

iOS implements it as a `Purchases` Capacitor plugin (`ios/App/App/PurchasesPlugin.swift`, next to
`StorefrontPlugin.swift`; StoreKit 2, which the iOS 15 deployment target already supports). A
transaction is `finish()`ed **only after the backend accepted it**, so if our backend is down or the
app dies mid-purchase, StoreKit hands the same transaction back on next launch and the app sends it
again: that is the "queue and retry" the resilience contract asks for, and it is the store's own
queue, not a second outbox.

`billingChannel` becomes `embedded` (web), `store` (an app whose platform has a purchases plugin)
or `none` (an app without one, or whose products could not be loaded: no buy button, fails closed
as today). The store's display name comes from one map (`App Store` / `Google Play`), used both for
the buy screen and for "billed through ..." from `SubscriptionDto.billingSource`.

Purchasing stays a Tier-3, online-only action (`OfflineDisabledWrap`, `useGatedMutation`), as checkout
is today. After a purchase the app shows "Confirming your purchase..." until `sync` answers, and
re-syncs whenever it returns to the foreground.

**Removed from the app path**: the `external` channel, the storefront check in billing, and the
hosted-checkout hand-off (`pendingCheckout`, `useCheckoutResume`). **Kept for now**:
`POST /api/billing/checkout-link` and `/checkout-complete`, because 1.0 to 1.2 installs still use
them. They are deleted in a follow-up once `NATIVE_MIN_SUPPORTED_BUILD` reaches the first build with
In-App Purchase.

## Android later: what it adds, and what it doesn't touch

When Android comes, it adds:
- `GooglePlayProvider` (verify, notifications through Cloud Pub/Sub push, `subscriptionsv2.get`,
  acknowledge, cancel and refund), its credentials and config.
- An Android `Purchases` plugin with the same five calls (Play Billing Library; the household
  token goes in `setObfuscatedAccountId`, which takes up to 64 characters, so the UUID fits).
- Products in Play Console with the same ids.
- A row in the Help page and the Terms.

It does **not** change the shared core, the migration, the controller, the conflict rules, the
billing screens or `purchases.js`. Because Google subscriptions *can* be cancelled by us, rule 5
already says what happens if a household somehow has Apple and Google at once: Apple stays, Google
is cancelled and refunded.

## Everything else this touches

- **Help page** (`HelpTab.jsx`, "Changing your plan"): today it says payments are handled by
  Stripe. It will say: on the web, Stripe; in the app, the App Store, managed in Settings. Pinned by
  a test, per `.claude/rules/user-facing-help.md`.
- **Terms** (`marketing/terms.html`): the "Buying from the iPhone or iPad app" item currently says
  the app opens Stripe in Safari and to ask *us* for refunds. Rewrite: bought in the app means bought
  from Apple, under Apple's terms; cancel and refund through Apple. **Privacy** (`privacy.html`):
  add that in-app purchases go through Apple and we keep a transaction id and status.
- **App Store listing**: the App Privacy label gains "Purchases: Purchase History" (linked to the
  user, App Functionality); `PrivacyInfo.xcprivacy` gets the same. The description links Apple's
  standard Terms of Use (EULA); the buy screen shows price, period, and Terms and Privacy links, as
  Apple requires.
- **Docs**: `.claude/rules/billing.md` ("Selling in the App Store app" is rewritten),
  `docs/architecture/billing.md`, `native-apps.md`, and the resilience register's "Billing channel"
  row (now `embedded` / `store` / `none`, plus the store's own transaction queue as the
  retry mechanism).
- **Admin portal**: show the billing source and environment beside the Stripe ids. (Built.)
- **Refunds**: "Request a refund" opens Apple's in-app refund sheet for an App Store household. (Built.)

## Checked against Apple's documentation (2026-11-14)

Read from Apple's own pages (Review Guidelines 3.1.1, 3.1.2, 3.1.3, 5.1.1(v); the Developer Program
License Agreement, Schedule 2 section 3.8; "Auto-renewable subscriptions"; "Offering account deletion
in your app"; StoreKit's `Transaction.updates`, `finish()`, `purchase`, `AppStore.sync()`,
`currentEntitlements`, `showManageSubscriptions(in:)`, `beginRefundRequest`; App Store Server
Notifications "Responding" and "Enabling"; Get All Subscription Statuses; Apple's Java library README).

| Apple says | Where we do it |
|---|---|
| Restore mechanism for restorable purchases (3.1.1); `AppStore.sync()` only on an explicit tap | **Restore purchases** button; `restore()` is the only caller of `sync()` |
| Sign-up screen: name and duration, full renewal price "shown clearly and prominently", what you get, Terms and Privacy links (Schedule 2 3.8(b)) | Billing's store channel: store price per period, benefit list, `LegalLinks`, renewal disclosure. The web's per-month and "Save 39%" lines are dropped there, so the billed amount is the most prominent price |
| No way to subscribe twice to "variations of the same thing" (3.1.2(b)) | One subscription group; prepare refuses an entitled household; the purchase claim |
| Make the system manage screen easy to reach; not on an iPad app running on a Mac | **Manage subscription** (`showManageSubscriptions(in:)`); on a Mac it says where to go instead |
| Start a `Transaction.updates` listener at launch; unfinished transactions arrive there once | `PurchasesPlugin.load()`, registered in `capacitorDidLoad`; plus `unfinished` sweeps |
| `finish()` after delivering the service | Only after the backend answers 2xx (`lib/storeSync`) |
| UIKit apps use `purchase(confirmIn:options:)` | iOS 17+; `purchase(options:)` on iOS 15-16 |
| Refunds: `beginRefundRequest` "from account settings or a help menu" | **Request a refund** on Billing; a granted refund arrives as a notification |
| Account deletion: say billing continues through Apple, ask them to cancel first, give `showManageSubscriptions` or apps.apple.com/account/subscriptions | Delete screen's notice: **Manage subscription** in the app, Apple's link on the web |
| Notifications: answer 200-206 for success; 4xx/5xx is retried (production only, 5 times over 72h); **sandbox sends once, never retried**; recover outages with Get Notification History | 200 for anything understood, 401 forged, 503 transient. `StoreNotificationRecovery` reads Apple's failed deliveries hourly in both environments, so a sandbox notice landing on a cold lower backend still applies |
| Billing grace period: the app must still read the renewal status; fulfil the offer through it (Schedule 2 3.8(c)) | Grace period maps to PAST_DUE, which stays entitled |
| Verify with Apple's root certificates; online checks on (README); appAppleId for production | `AppleRootCA-G3.cer`; online checks on, with a check that could not reach Apple treated as retryable (503), never as a forgery |

**Choices that differ from a reading of the docs, on purpose:**
- `CONSUMPTION_REQUEST` (Apple asks for usage data when someone requests a refund) is not answered.
  Apple: "If not [consented], don't respond", and we don't ask for that consent.
- The in-app Help page still quotes the web's prices. Allowed on the US storefront (3.1.1(a), 3.1.3),
  which is the only one the app is on. Revisit if the app is ever offered elsewhere.

## Phases

### Phase 0: Nate, in App Store Connect (about an hour, plus Apple's wait)
- Sign the **Paid Applications Agreement**, add bank and tax details. In-App Purchase can't even be
  tested until this is active; Apple can take a day or more.
- Enroll in the **App Store Small Business Program** (15% instead of 30%).
- For **each** app record, Huddle and Huddle Lower: one subscription group "Huddle"; the ten
  products with the prefixed ids (Claude supplies the exact list), ranked Pro Unlimited, Practice,
  Studio, Starter, then Plus; Family Sharing off; prices at the nearest points; Billing Grace Period
  on, 16 days; promoted purchases off.
- App Store Server Notifications, Version 2, both URLs on each app record pointing at **its own**
  backend: Huddle at `api.huddle.fitness`, Huddle Lower at `api.dev.huddle.fitness`.
- An **In-App Purchase key** (Users and Access, Integrations). Secrets go in with `gh secret set`
  from a paste-ready block.
- Note Huddle Lower's Apple ID (Huddle's is 6826555272) and create a sandbox tester.
- **App Store metadata Apple requires for subscriptions:** a link to the Terms of Use (Apple's
  standard EULA, https://www.apple.com/legal/internet-services/itunes/dev/stdeula/, or a custom EULA
  in App Information) in the app description, and the Privacy Policy URL. Each subscription needs a
  display name and description (people see them in Manage subscription) and a review screenshot.
- **Every subscription: Purchase Options → Available from "The App Store" only, Multiseat
  Purchases "Not Allowed".** Apple turns multiseat on by default (organizations buying seats through
  Apple Business / School Manager); one subscription per household can't represent seats, and those
  purchases carry no household token. Also: Family Sharing off, App Store Promotion off.
- Subscription group display name: "Huddle: Workout Tracker" (Huddle Lower's group id 22587372).
- **Billing Grace Period:** 16 days, "All Renewals", "Production and Sandbox Environment" (it is set
  per app, not per product, and takes up to 24 hours).
- After entering the notification URLs, send Apple's test notification (App Store Server API,
  Request a Test Notification) and check it arrived (`billing_events` has no row for TEST, but the
  backend logs no rejection; the status endpoint says whether we answered 200).
- **iPhone and iPad apps on Mac:** if Huddle is offered there, Manage subscription falls back to
  telling people to use the App Store app (Apple: don't show the sheet on a Mac).

### Phase 1: Backend (about 4 to 5 days)
The migration; the shared core (`StoreBillingProvider`, `StoreSubscriptionState`, the controller,
`applyStoreState` with the conflict rules, `isPaying`, the watchdog asking the row's own provider,
deletion); `AppStoreProvider`; config; the new event types. Tests: every row of the overlap rules
and the state mapping against a fake provider; `AppStoreProvider` against signed sandbox data
captured in Phase 3 (Apple-signed, so it verifies offline with the bundled root certificate); the
controller's refusals (Stripe-paying, comped, another device mid-purchase, a member without
`MANAGE_BILLING`).

### Phase 2: App and web (about 4 days)
`PurchasesPlugin.swift` and `purchases.js`; the `store` channel through the five upgrade surfaces
that already read the channel (`PlusUpsell`, `PlanBadge`, `BillingTab`, `LoginsSection`,
`HistoryWindowModal`); Restore Purchases; the two "billed elsewhere" states; deletion wording; Help,
Terms, Privacy. Tests: unit tests with the plugin mocked; a web e2e and parity test for a seeded
App Store household (it sees "billed through the App Store" and the web checkout refuses it); a
StoreKit configuration file so the simulator lists all ten products with no network, and a Maestro
flow that opens Billing and finds the store's prices.

### Phase 3: Prove it on lower (about 2 days)
TestFlight build of Huddle Lower against `api.dev.huddle.fitness`, sandbox tester: buy Plus; upgrade
to Pro; change band; switch to yearly; cancel and let it expire; refund (sandbox); restore on a
second device; Ask to Buy; web checkout and app purchase racing; a second device during a purchase;
backend down mid-purchase (it must land on the next launch). Each ends with exactly one billing
source. Signed data from these runs becomes the Phase 1 fixtures.

### After 1.3.0 is approved
- **Turn Streamlined Purchasing off** on Huddle (Monetization → Subscriptions → Streamlined
  Purchasing → Edit). It is on by default and Apple only allows turning it off once an approved build
  uses `PurchaseIntent`, which 1.3.0 does. Off, "subscribe" on the App Store page opens the app and
  completes there with the household's token. Until then the backend adopts a token-less purchase
  reported by a household's owner (billing.md).

### Phase 4: Submit 1.3.0
The products are submitted together with the build: Apple requires the first subscription group,
and every subscription in it, to be in the same draft submission as a new app version. Review notes explain: in the app, the App Store; a household billed on the web sees
"billed on huddle.fitness"; the demo account is Free so the reviewer can buy with their sandbox
account.

**Total: about 2 weeks of build and test, plus Apple's agreement and review waits.**

## Verified, not assumed (2026-11-14)

- **Apple's Java library 5.2.0** resolves cleanly in our Spring Boot 4.1.2 / Java 25 build (it uses
  Jackson 2, OkHttp 4.12 and java-jwt, which sit beside our Jackson 3 without conflict). Run on Java
  25.0.3, it signed a request with an ES256 key and reached Apple's sandbox API (401 with a fake key,
  as expected), and its verifier loaded Apple's root certificate and rejected junk.
- **The library has everything the plan uses**: `SignedDataVerifier.verifyAndDecodeNotification` /
  `verifyAndDecodeTransaction`, `AppStoreServerAPIClient.getAllSubscriptionStatuses`,
  `setAppAccountToken` and `getTransactionInfo`; statuses `ACTIVE`, `EXPIRED`, `BILLING_RETRY`,
  `BILLING_GRACE_PERIOD`, `REVOKED`; `getAppAccountToken()` is a `UUID` on both the transaction and
  the renewal info. It needs the app's Apple ID for production verification (we have it).
- **TestFlight purchases run in sandbox**; a missing sandbox notification URL sends both
  environments to the production URL. Hence "both environments accepted everywhere".
- **Huddle Lower is a separate app** (`fitness.huddle.app.lower`), so it needs its own products and
  notification URLs; the id prefix keeps every id unique.
- **Google Play**: `setObfuscatedAccountId` takes up to 64 characters and comes back as
  `externalAccountIdentifiers.obfuscatedExternalAccountId`; subscriptions can be revoked with a full
  or prorated refund server-side; new purchases must be acknowledged within 3 days.
- **Our code**: billing has one row per account and derives entitlement from status and period
  end, which is what lets every store reuse it; `isPayingThroughStripe` reads nothing
  Stripe-specific; the watchdog and `CompGrantService.blockedByStripe` are the only Stripe-only
  paths that need generalising; 1.0 to 1.2 still call `/checkout-link`.

## Not yet proven (needs Phase 0)
- A real signed sandbox transaction and notification verifying end to end (the unit tests use
  Apple's payload types, not Apple's signatures). Capture them in Phase 3 as test fixtures.
- `PurchasesPlugin.swift` on a device: it compiles in `mobile-ci`, but StoreKit's purchase sheet,
  Ask to Buy and the manage sheet need a sandbox tester on a phone.
- Configuration in the deploy repo: `APPLE_IAP_BUNDLE_ID`, `APPLE_IAP_APP_APPLE_ID`,
  `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRODUCT_PREFIX` (env vars) and
  `APPLE_IAP_PRIVATE_KEY` (secret), per environment, plus the notification URL
  `/api/webhooks/store/app-store` on each app record.
- V105's number: renumber at merge time if `main` has taken it.

## Phase 0 progress (2026-11-14)
- Paid Apps Agreement signed; bank account (PNC, Starner Consulting Co.) and W-9 submitted. Agreement
  **Processing**, bank account **Processing**, W-9 **Active**.
- Small Business Program enrollment submitted (no associated developer accounts).
- In-App Purchase key "Huddle server" created and downloaded (team-wide, covers both apps):
  Key ID `N93N6MMUBY`, Issuer ID `e1d9d530-bf88-4df8-8666-3f3e052555c5` (`APPLE_IAP_KEY_ID`,
  `APPLE_IAP_ISSUER_ID`; neither is secret). The `.p8` is in Nate's safe storage and goes into the
  deploy repo only as the `APPLE_IAP_PRIVATE_KEY` secret.
- Huddle Lower's Apple ID: `6826555225` (`APPLE_IAP_APP_APPLE_ID` on lower; Huddle's is `6826555272`).
  Its License Agreement is already "Apple's Standard License Agreement" (the EULA); the app
  description still needs a link to it in 1.3.0's metadata.
- Billing Grace Period: on for Huddle Lower (16 days, all renewals, production and sandbox).
  Streamlined Purchasing is ON and can't be turned off yet (see "After 1.3.0 is approved").
- Billing Grace Period on for Huddle too (same settings).
- 2026-11-16: Apple answered the 1.2.0 appeal: In-App Purchase is REQUIRED, fixable in the next
  update. Nate asked App Review to approve 1.2.0 as a bug-fix submission; IAP ships in 1.3.0.

## Phase 0 progress (2026-11-17): Huddle Lower's App Store Connect is set up
- **All ten subscriptions exist** in group 22587372 ("Huddle: Workout Tracker"). Every one: United
  States only, App Store only, multiseat Not Allowed, an English (U.S.) display name and description,
  and a review screenshot (Nate). Yearly ones use "1 Year Upfront"; "Monthly with a 12-Month
  Commitment" is left unset.

  | Level | Product id (`huddle.lower.` +) | Subscription id | US price |
  |---|---|---|---|
  | 1 | `pro.unlimited.month` / `.year` | 6835712887 / 6835713734 | $149.99 / **none yet** |
  | 2 | `pro.practice.month` / `.year` | 6835711865 / 6835712543 | $79.99 / $789.99 |
  | 3 | `pro.studio.month` / `.year` | 6835709072 / 6835709989 | $39.99 / $389.99 |
  | 4 | `pro.starter.month` / `.year` | 6835706993 / 6835707889 | $19.99 / $189.99 |
  | 5 | `plus.month` / `.year` | 6835701506 / 6835705535 | $3.99 / $29.99 |

  Monthly and yearly of one plan share a level, so switching between them is a crossgrade.
- **Pro Unlimited Yearly has no price.** $1,489.99 (the web's $1,490, a cent under like every other
  plan) is above the highest price App Store
  Connect offers ($1,000.00). Apple has 100 higher price points (up to $10,000), but only the Account
  Holder can request them. Until it has a price, StoreKit doesn't return the product, so the app
  doesn't offer it (`useStoreCatalog` drops what the store doesn't return). Nate decides: request the
  higher points, or sell it at $999.99 / $1,000.00 in the app.
- **Notification URLs:** Huddle Lower's production and sandbox URLs are both
  `https://api.dev.huddle.fitness/api/webhooks/store/app-store`. App Store Connect no longer offers a
  version choice; new URLs get Version 2.
- **Lower's backend config** is worktrac-deploy PR #90 (into `lower`): bundle id, Apple ID, issuer,
  Key ID, prefix `huddle.lower.`, and the `APPLE_IAP_PRIVATE_KEY_LOWER` secret, which Nate still
  has to set with `gh secret set` before that PR merges.
- Still to do: that secret, then `/deploy-to-lower` of this branch and the deploy PR, then Phase 3
  on a TestFlight build. Huddle (production) gets the same subscriptions with `huddle.` ids before
  1.3.0 is submitted.

## Phase 0 progress (2026-11-18): lower is live, Huddle's App Store Connect is set up
- **Lower:** `APPLE_IAP_PRIVATE_KEY_LOWER` set, #547 deployed, worktrac-deploy #90 merged. Lower's
  running revision carries all six `APPLE_IAP_*` settings and started cleanly.
- **Pro Unlimited Yearly price, decided:** it stays out of the app for now (the app hides an unpriced
  plan, so no code changes). The Account Holder asks Apple for the higher price points and, if
  granted, sets $1,489.99. $999.99 is the fallback only if Apple refuses: it would undercut the
  web's $1,490 by $490, and raising a subscription price later needs subscribers' consent.
- **Huddle (production, app 6826555272):** group "Huddle" (22590367, display name "Huddle: Workout
  Tracker"); the same ten subscriptions with `huddle.` ids, the same prices, levels and settings as
  lower (US only, App Store only, multiseat Not Allowed, Family Sharing off, 1 Year Upfront).

  | Level | Product id (`huddle.` +) | Subscription id | US price |
  |---|---|---|---|
  | 1 | `pro.unlimited.month` / `.year` | 6836145445 / 6836146435 | $149.99 / **none yet** |
  | 2 | `pro.practice.month` / `.year` | 6836143374 / 6836144383 | $79.99 / $789.99 |
  | 3 | `pro.studio.month` / `.year` | 6836142275 / 6836142893 | $39.99 / $389.99 |
  | 4 | `pro.starter.month` / `.year` | 6836141555 / 6836142051 | $19.99 / $189.99 |
  | 5 | `plus.month` / `.year` | 6836140810 / 6836141374 | $3.99 / $29.99 |

  Notification URLs (production and sandbox) are both
  `https://api.huddle.fitness/api/webhooks/store/app-store`: App Review and TestFlight buy in the
  sandbox even against the production app, and the backend verifies both environments. Billing
  Grace Period: 16 days, all renewals, both environments.
- **Production review screenshots are still missing.** Take them from the Billing screen of the
  TestFlight build during Phase 3 (the first build that shows real store prices), one per
  subscription. They are needed before 1.3.0 is submitted, not before.
- **TestFlight buys with the tester's own Apple Account**, not a Sandbox Apple Account, and is never
  charged. Sandbox accounts (one exists: Users and Access, Sandbox) only work in development builds
  from Xcode, which this project doesn't make.
- **Browser automation note:** App Store Connect's level reorder (a drag-and-drop list) ignores every
  drag while the page is hidden (`document.visibilityState === 'hidden'`, for example the window is
  behind another one). Bring the window forward first.

## Left for Phase 0 (only visible in App Store Connect)
- The exact price points Nate picks (the code shows whatever the store returns, so this never
  touches code).
- Whether the Paid Applications Agreement is already in place (likely not, for a free app).
