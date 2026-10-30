# Native apps: Huddle on the App Store

The enforceable version of this document is `.claude/rules/native-apps.md`, which auto-loads when
you touch the native code. This is the "why".

## What the app is

The iOS app is **the same React bundle** the web serves, wrapped by [Capacitor](https://capacitorjs.com).
The built `dist/` is bundled inside the app; nothing is loaded from `app.huddle.fitness` at run
time. On iOS it runs in WKWebView, the same WebKit engine as Safari and the installed PWA, so it
renders the same. There is one codebase: `frontend/src` is shared, and `frontend/ios/` is a thin
native project that is rarely edited by hand.

Two things decided that shape:

- **Loading the live site remotely (`server.url`) was rejected.** App Review rejects thin
  website wrappers (guideline 4.2), and offline would then depend on a service worker that
  WKWebView does not run on a custom scheme.
- **A second codebase (React Native, Swift) was rejected.** The offline machinery, the outbox and
  the History sync are the product, and they took months to get right. Running the same code is
  the only way the app inherits that.

Android uses the same approach and is deferred: iOS ships first (decided 2026-10-20).

## The one rule: device code lives in `lib/native/`

Most of what changes inside the app is not the UI but the edges of the browser: a download does
nothing in WKWebView, `target="_blank"` either does nothing or replaces the app, `navigator.vibrate`
does not exist on iOS, the status bar ignores `theme-color`. Each of those gets a small function in
`frontend/src/lib/native/` with two branches:

- **web**: exactly the code that ran before the app existed;
- **native**: a lazily imported Capacitor plugin.

Callers never see the branch. That is the same reasoning as the resilience contract's "one
mechanism per job" (`docs/architecture/resilience.md`): a component that asked `isNativeApp()`
itself would be a second code path nothing tests on the web, and the web is where every e2e spec
runs. The guard script enforces the mechanical half (no `@capacitor/*` import outside
`lib/native/`); the other half is that each function's web branch is pinned by a unit test.

`@capacitor/core` is the one Capacitor package in the web bundle. Its `isNativePlatform()` is a
constant `false` in a browser, and every plugin is imported inside the native branch, so a browser
never downloads one.

## Building it

```bash
cd frontend
NATIVE_API_URL=https://<backend origin> npm run build:native   # vite build --mode native + config.json
npx cap sync ios                                                # copies dist/ into the iOS project
```

- **`--mode native` turns the service worker off.** WKWebView won't run one on `capacitor://`,
  and on Android a service worker would keep serving the old bundle after a store update. The
  app needs none: its files are on the device. VitePWA's `disable` keeps `virtual:pwa-register`
  importable as a no-op, so the update banner is the same code and simply never fires.
- **`config.json` is baked in.** On the web, CI deletes it from the artifact and the deploy
  writes one per environment. An app has no deploy, so `write-native-config.mjs` writes it from
  `NATIVE_API_URL`, which has no default: a store binary pointed at the wrong backend cannot be
  fixed by redeploying.
- There is no Mac in this project. Every iOS build happens on a GitHub macOS runner.
  `mobile-ci.yml` builds unsigned for the simulator on every push that touches `frontend/`, boots
  an iPhone and an iPad, uploads screenshots and the app's console, and then has Maestro check the
  login screen actually appeared (`e2e/mobile/launch.yaml`) -- the console can't say, because a
  healthy boot logs nothing. Signed TestFlight/App Store builds come from the manually triggered
  `mobile-release.yml`, which runs `mobile-ci.yml` first and uploads only if it passes.

## What is different from the web, and why it is fine

| | Web (Safari / PWA) | App | Consequence |
|---|---|---|---|
| Service worker | Precaches the shell; silently reloads after a deploy | None | Offline cold boot is *more* reliable in the app (no precache to miss). The "SW silent forced reload" condition doesn't exist there. |
| Updates | Next navigation after a deploy | Only via the App Store | Old builds live for months. Backend changes must stay additive (version-skew rules, Phase 7). |
| `config.json` | Fetched, with a last-known fallback | Local file | Can't fail to load |
| Keyboard | Overlays the page; Safari scrolls the field into view | `Keyboard.resize: "native"` (the WebView ends at the keyboard) plus `keepFocusedFieldVisible` | The keyboard plugin disables WebKit's own scroll-into-view, so `"none"` (tried first, to match Safari) left the login fields under the keyboard on the first TestFlight build. The `SessionBar` now rides on the keyboard while typing |
| Background | Tab keeps running for a while | JS suspended; app may be killed | Same as a reload at an arbitrary instant (resilience axis C), which the app already survives |

Storage (`localStorage` for the auth token and UI state, IndexedDB for the outbox and query cache)
lives in WKWebView's storage, which has the same exposure as today's installed PWA. Measure its
survival across app kill, reboot and update on a device before deciding anything needs native
storage.

## Status

The phased plan and checklist live outside the repo (Nate's launch checklist). What has landed is
recorded here as it lands:

- **Shell** (`feat/native-shell`): `lib/native` + guard, `build:native`, the committed iOS project
  with every planned plugin installed, `ITSAppUsesNonExemptEncryption`, `mobile-ci.yml`.
- **Adapters** (`feat/native-adapters`): export through the share sheet, Terms/Privacy in the
  in-app browser, real haptics, History's pull-to-refresh in the app, and the store version in
  Contact Us diagnostics. Cost on the web: `@capacitor/core` in the main chunk (~9 KB raw, ~3 KB
  gzipped); the plugins' own chunks are kept out of the precache.
- **Launch** (`feat/native-launch`): app icon (light + iOS 18 dark), branded launch screen,
  `MainViewController` painting every background in `--color-bg`, and the Help page's install
  section in the app.
- **Version skew** (`feat/native-version-skew`): `X-Huddle-Client` on every request and
  `[client=…]` on every log line; `/me` carries `client.minSupportedNativeBuild` (env
  `NATIVE_MIN_SUPPORTED_BUILD`, default 0) and the auth snapshot keeps it for offline opens;
  `UpdateAppBanner` below it (a banner, never a gate); `.claude/rules/api-compatibility.md`; the
  frozen list of durable-write keys; and the "Which app builds are live?" query.
- **Phone extras** (`feat/native-extras`): "rest's up" local notification while backgrounded, the
  screen kept on during a workout, and the matching Help lines.
- **Release pipeline** (`feat/native-release`): `mobile-release.yml`, the Fastfile/Matchfile and
  per-variant bundle id + display name. Unverified until the Apple account exists.
- **Billing channels** (`feat/native-billing`): the app reads its App Store storefront (a small
  StoreKit plugin) and links out to Stripe's hosted checkout on the US storefront only; everywhere
  else it shows the plan with no way to buy. `POST /api/billing/checkout-link`, the public
  `/checkout-complete` landing page, and a resume reconcile when the app comes back.
- **Universal links** (`feat/native-links`): the app's Associated Domains entitlement (per variant),
  in-app routing of a link that opened the app, and the web host serving
  `/.well-known/apple-app-site-association`.
- **The link-ownership file** (`feat/native-aasa-file`): `frontend/public/.well-known/apple-app-site-association.json`,
  naming both apps under the Apple Team ID `R73HV8H48W` and claiming `/join*`, `/app/*` and
  `/checkout-complete*`. After it deploys, `curl -i https://app.dev.huddle.fitness/.well-known/apple-app-site-association`
  must return that JSON (not `index.html`) with `Content-Type: application/json`. That is also the
  first check that the deploy repo's Static Web Apps upload kept the dot directory. The first
  deploy served it as `application/octet-stream`: Static Web Apps takes a file's type from its
  extension and ignores a route's `Content-Type` header, so the file is now stored as `.json`
  and that URL is a rewrite onto it.

- **Rating prompt** (`feat-app-review-prompt`): Apple's rating sheet after the 3rd finished
  workout, then every 5th (at least 30 days apart), from the app's own StoreKit plugin
  (`AppReviewPlugin.swift`); and "Rate Huddle" beside Contact Us in the account menu.

## Asking for a rating: Apple's sheet, at the end of a workout

The usual pattern ("Enjoying Huddle?" first, then the store prompt only for a yes) was considered
and rejected. Apple requires its own API for rating requests (guideline 5.6.1), and filtering who
sees it is review gating, which risks a rejection. Apple's sheet is already one tap of stars
without leaving the app, so a screen in front of it would only cost ratings. Unhappy people get
Contact Us, which sits beside "Rate Huddle" in the menu at all times rather than as a branch of the
prompt.

**When:** the "End workout" tap, 1.5s later, once the recap has been said. A PR felt like the
happier moment, but it lands mid-workout with a rest timer running. The 3rd workout with a set in
it, then every 5th after the last ask, and never within 30 days of the last ask. Counted per device,
because the rating goes to the phone's Apple ID whoever was logging.

**What it can't know:** whether the person rated, or whether the sheet even appeared. Apple
reports neither. iOS shows the sheet at most three times a year per app and normally not again once
someone has rated, so the schedule only has to avoid asking often; Apple does the rest. An ask
iOS declines still counts, so the next waits for five more workouts.

**Testing:** the sheet never appears in TestFlight builds and always appears in Debug builds, so
neither tells you the schedule works. `reviewPrompt.test.js` does.

## Selling in the app: why a link-out, and only in the US

Apple's rules decide what an App Store app may show about paying, and they differ by storefront.
Since the 2025 Epic v. Apple injunction, an app on the **US** storefront may link to a web
checkout with no Apple commission (as of 2026-10, while the district court sets a rate; a fee may
come). Everywhere else, a link or price for a digital subscription is grounds for rejection unless
the app also sells through In-App Purchase, which would mean a second billing system, a second
entitlement source and Apple's cut. So the app has three billing channels (`billing.md`, "Selling
in the App Store app"):

- **The web is untouched.** Its checkout is the embedded one; nothing about a browser changed.
- **The storefront comes from StoreKit, not from the person.** Region, language and IP all lie
  about which store the Apple ID belongs to, and the store is what App Review judges.
- **It fails closed.** Until StoreKit answers `USA`, the app shows no way to buy. A US household
  that briefly sees no button loses a second; a non-US reviewer who sees one rejects the build.
- **The purchase is the same purchase.** `/checkout-link` shares every check with
  `/checkout-session` (`BillingController.prepareCheckout`); only the Stripe page differs, so the
  webhook, the watchdog and the reconcile need nothing new. The app notes the session id before
  leaving and reconciles it on return, which is what makes the plan update in front of them.

**Re-check the US rule before every App Store submission.** It comes from a court order under
appeal, not from Apple's guidelines being settled.

## Releasing (once the Apple account exists)

First run on 2026-10-24, in this order. The only fix it needed was found before running: the
`certificates` lane lacked `setup_ci`, so `match` would have tried the runner's login keychain
(#417). The certificates run and the first Huddle Lower upload to TestFlight then both passed first
time.

1. **Create the GitHub Environments** `mobile-lower` and `mobile-production` (Settings →
   Environments), restricted to `main`, production with a required reviewer. Secrets in each:
   `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the .p8 file's contents), `APPLE_TEAM_ID`,
   `MATCH_PASSWORD`, `MATCH_GIT_URL` (`https://github.com/<owner>/worktrac-certs.git`),
   `MATCH_GIT_BASIC_AUTHORIZATION` (base64 of `username:token` for the fine-grained token).
   Variable: `NATIVE_API_URL` (the lower or production backend origin).
2. **Actions → "Release mobile app" → lane `certificates`**, environment `lower`. This creates the
   distribution certificate and both App Store profiles in the certificates repo. Once only, then
   yearly.
3. **Lane `beta`, environment `lower`.** Builds Huddle Lower against the lower backend and uploads
   it to TestFlight. Its `gemfile-lock` artifact became `frontend/Gemfile.lock`; do the same after
   any gem bump, since nothing here can run Ruby.
4. Production is the same lane with environment `production`, dispatched from `main`; promoting
   the build from TestFlight to the App Store is a manual click in App Store Connect.


## Old builds: why the API is now additive-only

A web bundle lives for hours after a deploy. An App Store build lives until its owner updates,
which can be months. So the backend now has callers running code that is no longer on `main`, and
three things follow (the enforceable version is `.claude/rules/api-compatibility.md`):

1. **Know who is calling.** Every request says which build sent it, and the logs can count people
   per build. Removing a field or tightening a rule waits for that count.
2. **Ask, never block.** Below `minSupportedNativeBuild` the app shows a banner. A hard gate would
   turn "this build is old" into "you can't log your set", which is exactly the blank/locked-out
   outcome the resilience contract forbids, and it would strand whatever was queued.
3. **Queued writes outlive the code that queued them.** The outbox survives a store update, so the
   new build must replay what the old one queued, under the same keys with the same variables.
   `lib/outboxCompatibility.test.js` pins every key ever shipped.
