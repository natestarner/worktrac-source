# App Store submission: listing, reviewer notes, privacy answers

Drafts for launch checklist phase 10 (store listing and compliance), iOS only. Everything here is
**a draft for Nate to edit**, written 2026-10-21 from the code and the marketing site. Anything
Apple decides (rules, field limits, categories) should be re-checked in App Store Connect at
submission time.

## Listing (checklist 10.3)

| Field | Draft | Limit |
|---|---|---|
| Name | Huddle: Workout Tracker | 23 / 30 |
| Subtitle | Gym log for the whole family | 28 / 30 |
| Category | Health & Fitness (secondary: none) | |
| Keywords | `lifting,weightlifting,strength,sets,reps,PR,1RM,training,fitness,offline,kids,coach,routine,barbell` | 99 / 100 |
| Promotional text | Log a set in two taps, switch between everyone in the house, and keep logging with no signal. Your whole history, PRs and trends, on one screen. | 144 / 170 |
| Support URL | https://huddle.fitness/support.html (public, so it works signed out; Stripe's support URL is the same page) | |
| Marketing URL | https://huddle.fitness | |
| Privacy Policy URL | https://huddle.fitness/privacy.html | |

Keywords deliberately repeat no word from the name or subtitle (Apple already indexes those) and
lean on what people search for that the name doesn't say.

### Description

> One screen, the whole family's workout.
>
> Huddle is a workout log built for people who train together. Tap a name to switch between
> everyone in the house: each person keeps their own log, history, records and rest timer, and
> nobody's numbers get mixed up with anybody else's.
>
> LOG A SET IN TWO TAPS
> Weight and reps prefill from last time, so most sets are one tap and go. What you did last
> session is right there on the screen.
>
> WORKS WITH NO SIGNAL
> Basement gym? Every set, edit and note saves on your phone first and syncs the moment you're
> back, in order and without ever double-logging. Your history, PRs and routines stay readable the
> whole time.
>
> RECORDS THAT CELEBRATE
> Huddle tracks your best estimated 1RM, the heaviest you've ever lifted, and your biggest single
> workout for every exercise, and celebrates each one as it happens. Every record names the sets
> behind it.
>
> BUILT FOR THE PHONE IN YOUR HAND
> A "rest's up" notification when your phone is locked between sets, the screen kept awake during a
> workout, haptics when you hit a PR, and your data exported through the share sheet.
>
> FREE FOR THE WHOLE FAMILY
> Everybody in the house gets their own log at no cost, with no ads. Huddle Plus adds your lifetime
> history, all-time records, importing past workouts, and personal logins for anyone who wants one.

Before using this, confirm the description matches whatever the app actually offers at
submission: the "rest's up" notification, keep-awake and haptics are app-only features, and Plus
details must match `billing.md`.

## Notes for the reviewer (checklist 10.8)

Paste into App Store Connect → the version → App Review Information → Notes, with the demo login
(checklist 10.1) in the sign-in fields.

> Huddle is a workout log for households: one account holds several people (for example a parent
> and their children), each with a separate log. Profiles for children are created and managed by
> the adult account holder; a child does not sign in unless the account holder enables a personal
> login (a Plus feature).
>
> Native functionality: offline logging (sets are stored on the device and sync later, try
> airplane mode), a local "rest's up" notification when a rest timer finishes while the phone is
> locked, keeping the screen awake during a workout, haptic feedback on personal records, and
> exporting data through the share sheet.
>
> Payments: on the United States storefront, Huddle Plus is purchased through a link to our web
> checkout (Stripe), opened in Safari, as permitted for US storefront apps under guideline 3.1.1(a).
> On any other storefront the app shows no prices, purchase buttons or links. The app is available
> in the United States only. The demo account is on the Free plan so the upgrade link is visible
> under Account → Plan & billing.
>
> Demo account: [email] / [password].

## The demo account and the screenshots (checklist 10.1, 10.2)

The reviewer's demo household is three made-up people (Alex, Sam, Jordan) with about 20 weeks of
training, on the Free plan. It was written into the production account on 2026-10-26 by
`e2e/tools/demo-household.mjs`, through the app's own API. Its training is modelled, not drawn:
each lift has an underlying strength that grows like a real person's, the reps logged are what that
strength allows at the weight on the bar, and the weight follows what a lifter does (add after a
clean session, repeat after a miss, drop back after a third stall). So the plateaus, the flu in late
August, the family vacation in July and the recoveries all come out of the model. The tool also
checks that every barbell lift's est.-1RM and top-weight charts finish at their best.

- **Never put a real account's login in the repo.** The tool reads it from the environment.
- **A local copy** (`--register --write` against a local stack) is the same household, for trying
  screens before touching production.
- **Screenshots** come from `e2e/tools/app-store-shots.mjs`: the iPhone 6.9" (1320 × 2868) and iPad
  13" (2064 × 2752) sizes App Store Connect requires, light mode, captured from the running app. Two
  scenes have to log a set (mid-workout with the rest timer running, and the PR celebration); they
  run only with `ALLOW_WRITES=1`, so against production it captures read-only screens unless asked.
  They log three squat sets for Alex (the third a real est.-1RM record), then delete exactly those
  sets and end the workout, so the account returns to its seeded state. They refuse to start if
  Alex already has a workout going.
- **Framing:** History, PRs and Trends open on the Free plan's "See Plus" notice, so those scenes
  scroll until their content sits just under the sticky person/tab bar. Nothing is hidden or
  restyled. The app's logo header scrolls away with it; it is kept only where a screen is captured
  from the top. Don't splice it back in, because that would show a screen state that can't exist.
- **Captions** come from `e2e/tools/app-store-frames.mjs`. Each real capture, unaltered, sits under
  the brand lockup and a one-line headline on a cream ground, with the mark's circles faint behind
  it. Nate chose the `cream` theme on 2026-10-27 over `night` and `sunrise`, and asked for quieter
  background circles. The headlines reuse the marketing site's own claims. These captioned panels
  are what gets uploaded.
- **Header** (version page → Header and Search Results → Header) comes from
  `e2e/tools/app-store-header.mjs`: 21:9, 3840 x 1646. The lockup and the site's hero line sit inside
  the art safe area from Apple's own template (1646 x 661, centred), and the tool refuses to render
  if they don't fit. Two real captures flank it outside the safe area. **Search Results is left
  empty on purpose**: without that asset, the first three screenshots show in search, and those sell
  the app better than one banner. Every asset is RGB with no alpha channel, as Apple requires.
- **Store order is the file number.** Only the first two or three show in search results: logging,
  the PR celebration, then the strength chart.
- **Capture the finals in the morning.** The mid-workout scene shows the real start time ("Session in
  progress · started 6:12 AM" reads like a gym; "10:44 PM" does not).
- The window a Free account shows moves forward every day. By mid-November the July vacation and
  most of the flu dip have scrolled out of the reviewer's 90 days; re-seed if that matters.

## Privacy answers (checklist 10.5)

Must match `frontend/ios/App/App/PrivacyInfo.xcprivacy`. Cross-checked against the code on
2026-10-21. **Tracking: No** (no ads, no analytics SDK, no data shared with data brokers). Every
type below is **Linked to the user**, purpose **App Functionality** unless noted.

| App Store Connect category | Type | Where it comes from |
|---|---|---|
| Contact Info | Email Address | Sign-in, confirmation codes, invitations |
| Contact Info | Name | The names of the people in a household |
| Health & Fitness | Fitness | Workouts: exercises, sets, reps, weights, times |
| Health & Fitness | Health | Bodyweight check-ins |
| User Content | Other User Content | Workout and check-in notes |
| User Content | Customer Support | Contact Us messages |
| Identifiers | User ID | Account and login ids |
| Identifiers | Device ID | The random per-install id sent with each request to match a bug report to the logs (not an advertising id) |
| Purchases | Purchase History | Plan and billing events. Purposes: App Functionality, **Analytics** (the upgrade funnel in `billing.md`) |
| Diagnostics | Crash Data | The last client error, only when attached to a Contact Us message |
| Diagnostics | Other Diagnostic Data | App build and boot-failure record, attached the same way |

Not collected by the app: payment card details (entered on Stripe's page in Safari), location,
contacts, photos, browsing history. The server logs IP addresses for rate limiting and security;
Apple's form has no IP category, and that use is not tracking.

## Age rating (checklist 10.4)

Expect 4+: no violence, mature content, gambling, web browsing or unrestricted user-generated
content shared between strangers (notes and names are visible only inside one household). Do **not**
choose the Kids category. Re-check any US state age-assurance requirements at submission time.

## Also due at launch, outside the app

- **The marketing site announces the app** (checklist 11.7). Apple's own "Download on the App
  Store" badge, unaltered, sits in the homepage hero and in the closing band of the homepage and
  `pricing.html`. Every page carries Safari's Smart App Banner (`apple-itunes-app`), and the two FAQ
  answers that used to say "No app store" now point at the listing. `check-marketing.sh` check 10
  fails unless every App Store link and banner names the same numeric app id (the Apple ID under App
  Store Connect → App Information).
- **Re-check the US link-out terms right before submitting.** Checked 2026-10-27: guideline 3.1.1(a)
  says entitlements "are not required for developers to include buttons, external links, or other
  calls to action in their United States storefront apps", and Apple currently charges no commission
  on those purchases. That second part is open: the Ninth Circuit (Dec 2025) let Apple charge a fee
  based on its costs and sent the amount back to the district court, where Apple has proposed 15%
  (5% for Small Business Program members, per press reports, Aug 2026). A fee would not change the
  app; it would change Plus's margin. Joining the free App Store Small Business Program before then
  is cheap insurance.
- **The Privacy Policy and Terms cover the app** (checklist 10.7). `marketing/privacy.html` and
  `marketing/terms.html` describe the iPhone and iPad app: what it reads on the device, Apple as
  distributor, and that buying in the US app is Stripe in Safari. Live on huddle.fitness since
  2026-10-27 (#448).
