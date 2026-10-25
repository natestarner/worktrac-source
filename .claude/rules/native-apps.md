---
paths:
  - "frontend/src/lib/native/**"
  - "frontend/ios/**"
  - "frontend/capacitor.config.json"
  - "frontend/vite.config.js"
  - "frontend/scripts/*native*"
  - "frontend/scripts/ios-*"
  - ".github/workflows/mobile-*.yml"
  - "frontend/fastlane/**"
  - "frontend/Gemfile*"
  - "frontend/public/staticwebapp.config.json"
  - "frontend/public/.well-known/**"
---

# Native apps (Capacitor) invariants

The iOS app is the same React bundle, built with `npm run build:native` and wrapped by Capacitor.
Full narrative and the reasons behind each rule: `docs/architecture/native-apps.md`.

## `@capacitor/*` is imported ONLY under `frontend/src/lib/native/`

Everything else calls a function exported from `lib/native` whose **web branch is exactly the code
that ran before the app existed**. A component never asks "am I native?" and branches itself.
`scripts/check-resilience-invariants.sh` (§5b) fails the build on a static or dynamic import
anywhere else.

- **The one sanctioned exception is COPY that describes the platform itself.** `HelpTab`'s install
  section reads `isNativeApp()` because "add Huddle to your home screen" is false inside the app.
  Words may branch; behaviour may not. Each such branch carries a comment and a test pinning both
  variants (`HelpTab.native.test.jsx`). If a branch would change what a control *does*, it belongs
  in `lib/native` instead.
- **Plugins are imported lazily, inside the native branch.** `@capacitor/core` is the only package
  a browser downloads, and on the web `isNativePlatform()` is a constant `false`.
- **A new device capability = a new function in `lib/native`, with a test that pins its web
  branch.** If the web branch is not provably today's behaviour, the change is not invisible on
  the web, and its PR must say so.
- **Plugin chunks are not precached on the web.** `vite.config.js` names any lazy chunk made only of
  `@capacitor/*` (core excepted) `native-*.js`, and the service worker's `globIgnores` skips them.
  A new plugin import is covered automatically; don't import a plugin together with app code in
  one dynamic `import()`, or its chunk loses the prefix and lands in every web install's precache.

The adapters, each one a function whose web branch is the code it replaced:

| Adapter | Web branch (unchanged behaviour) | App branch | Callers |
|---|---|---|---|
| `saveFile(blob, name)` | `<a download>` + blob URL | Write to the cache directory, then the share sheet. A dismissed sheet is success, not an error | `api/export.js` |
| `externalLinkProps(url, { leaveApp })` / `openExternal(url, { onClose })` | `target="_blank"` anchor, no `onClick`; `onClose` never runs | In-app browser sheet (SFSafariViewController). `onClose` fires on the sheet's `browserFinished`, the **only** sign the person came back: the sheet never backgrounds the app, so `visibilitychange` and TanStack's refetch-on-focus never fire. `leaveApp` hands the URL to iOS instead (`openInBrowser`), for a destination that is another app | `LegalLinks.jsx`, `BillingTab`'s portal (`onClose` refreshes the plan), `UpdateAppBanner` (`leaveApp`: the App Store listing opens in the App Store, not as a web preview in the sheet) |
| `openInBrowser(url)` | new tab | Leaves for Safari (`@capacitor/app-launcher`). **For a page finished outside the app**: closing the in-app sheet never backgrounds the app, so a return that must be noticed (`useCheckoutResume`'s `visibilitychange`) needs Safari | `BillingTab`'s hosted checkout |
| `nativeHaptic(pattern)` | returns `false`, so `lib/haptics.js` takes its old routes | Apple's haptic engine; still behind the reduced-motion check | `lib/haptics.js` |
| `isInstalledApp()` | `display-mode: standalone` / `navigator.standalone` | always `true` | `PullToRefresh.jsx` (History's pull) |
| `keepScreenAwake()` / `allowScreenSleep()` | no-op | `@capacitor-community/keep-awake` while a workout is on screen; iOS releases it on background | `SessionBar.jsx` (its visibility effect) |
| `scheduleRestNotifications` / `cancelRestNotifications` / `ensureRestNotificationPermission` | no-op | Local notification at the moment each running rest timer fills, scheduled on `visibilitychange: hidden`, cancelled on return; permission asked when a rest timer first starts, never at launch | `hooks/useRestNotifications.js` (mounted in `AppShell`) |
| `listenForAppLinks(onPath)` | no-op (the browser already loaded the URL) | A universal link (or the checkout scheme link) that opened the app (`appUrlOpen`, or the launch URL, read once per launch) becomes an in-app path | `AppLinkRouter.jsx` (mounted in `App.jsx`, outside every route) |
| `appReturnUrl(hostname, search)` | the same on both: a pure function | `<bundle id>://checkout-complete…` for the app claiming that host, or `null` | `CheckoutCompletePage`'s "Return to the Huddle app" |
| `keepFocusedFieldVisible()` | no-op (Safari keeps the field in view itself) | Scrolls a focused field that is under the keyboard or the `SessionBar` to the centre (see "Keyboard" below) | `FocusedFieldKeeper.jsx` (mounted in `App.jsx`, outside every route) |

`APP_BUILD` (`lib/appBuild.js`) is `"<platform> <version> (<build>) <instant>"` in the app and the
bare instant on the web, clamped to **40 characters** because `ContactDiagnostics.appBuild` is
`@Size(max = 40)` and an over-long value would refuse the whole Contact Us message.
`NATIVE_APP_VERSION` / `NATIVE_BUILD_NUMBER` are baked in at `build:native` time, so the release
workflow must pass the same values to `xcodebuild`.

**Rest notifications only ever cancel their own** (`extra.kind === 'rest'`), so a later feature
that schedules notifications is never clobbered by the rest timer's cancel-on-return. Keep-awake has
**no setting** yet (decided 2026-10-21): a workout on screen keeps it on, and that is the only case.
If anyone asks for a switch, it is a per-device App Settings toggle, not per person.

**Billing channels** (`lib/native/billingChannel.js`, read through `hooks/useBillingChannel`):
`'embedded'` on the web (today's checkout, unchanged), `'external'` in the app on the **US App Store
storefront** (Stripe's hosted page in the phone's browser), `'none'` anywhere else in the app (no
price, purchase, upgrade link or portal). The storefront comes from the app's own StoreKit plugin
(`ios/App/App/StorefrontPlugin.swift`, registered in `MainViewController.capacitorDidLoad`), never
from region, language or IP. **It fails closed**: the app starts at `'none'` and an unreadable
storefront stays there. Full rules: `billing.md`, "Selling in the App Store app".

- Never enable `CapacitorHttp` (it patches `fetch`, changing abort/timeout/CORS semantics on one
  platform only; `api/client.js` is the one HTTP path) and never add `@capacitor/network` (a second
  "am I online?" signal; `useOnlineStatus` is the one).

## Universal links: three halves, and each one fails silently

A link to `app.huddle.fitness` (an invitation, an email's "Open Huddle") opens the installed app
only when all three agree. A missing half produces no error anywhere: the link just opens Safari.

1. **The app claims the domain.** `ios/App/App/App.entitlements` asks for
   `applinks:$(APP_LINK_DOMAIN)`, a build setting (`app.huddle.fitness`; the Fastfile sets
   `app.dev.huddle.fitness` for Huddle Lower). Signing needs **Associated Domains** on both App IDs
   (checklist 1.7), or `match`'s profiles won't carry the entitlement and the release build fails.
2. **The site vouches for the app.** `frontend/public/.well-known/apple-app-site-association.json`
   names both app IDs (`R73HV8H48W.fitness.huddle.app` and `….lower`; `R73HV8H48W` is the Apple
   Team ID), because lower and production serve the SAME frontend build; each app's entitlement
   decides which domain it actually claims. It claims `/join*`, `/app/*` and `/checkout-complete*`
   only, and `appLinks.test.js` pins both lists.
   - `staticwebapp.config.json` keeps `/.well-known/*` out of the single-page fallback; without that
     exclusion iOS receives `index.html` (`appLinks.test.js` pins it).
   - **The file is stored as `.json` and the extensionless URL Apple fetches is a route `rewrite`
     onto it.** Static Web Apps sets a static file's `Content-Type` from its extension and ignores
     a route's `Content-Type` header (lower served the extensionless file as
     `application/octet-stream` with the header rule in place). Don't rename it back.
   - `ci.yml` uploads the build with `include-hidden-files: true`: `upload-artifact` skips dot
     directories by default, which would drop the file on its way to the deploy repo.
3. **The app routes it.** `listenForAppLinks` → `AppLinkRouter` turns the URL into a path for the
   router. `/checkout-complete` becomes `/app/billing?checkout=<id>`, because that page's "go back to
   the app" is nonsense inside the app. Hosts other than the two web apps are ignored.
   - **⚠️ `App.getLaunchUrl()` is NOT the launch URL.** Capacitor returns
     `ApplicationDelegateProxy.lastURL`: the last link that opened the app, never cleared. So
     `listenForAppLinks` reads it **once per process** (`launchUrlRead`), and `AppLinkRouter`
     subscribes **once** (navigate through a ref, `[]` deps). Under `<BrowserRouter>` `navigate`
     changes identity on every pathname change. With `[navigate]` as the dependency, every tab tap
     re-subscribed and re-read the checkout link, so on 2026-10-24 the first TestFlight purchase
     left the person unable to leave the billing screen. `useCheckoutResume` has the same shape
     for the same reason. Pinned by `appLinks.test.js` and `AppLinkRouter.test.jsx`, both verified
     red against the old code.

**Universal links don't bring someone back from Stripe; the URL scheme does.** iOS opens a universal
link only when someone taps it on another site. Stripe's redirect after paying is not a tap, and a
tap on `/checkout-complete` is a same-site link, so both stay in Safari. The landing page's "Return
to the Huddle app" is `<bundle id>://checkout-complete?…` (`appReturnUrl`). `Info.plist` registers
`$(PRODUCT_BUNDLE_IDENTIFIER)` as the scheme, so Huddle and Huddle Lower never claim each other's
links. The scheme routes `checkout-complete` and nothing else, because any page or app can open a
custom scheme. Changing a bundle id means changing `APP_SCHEMES` in `appLinks.js` too.

Apple fetches the file through its own CDN, so a change can take a day to reach devices.

**Password AutoFill uses the same two files.** The entitlement also asks for
`webcredentials:$(APP_LINK_DOMAIN)` and the association file has a `webcredentials` section naming
both apps, so the login screen offers the password saved for the site. Same Associated Domains
capability, so no profile change. Without it nothing fails: the login screen just never suggests a
saved password. `appLinks.test.js` pins both halves. Developers report iOS's own "Save password?"
prompt still rarely appears inside a web view, so fill is the part this guarantees.

## A browser sheet's return trip is the app's job, not the web page's

The in-app sheet (`openExternal`) is a separate browser with **its own storage**: the person is
signed out of Huddle inside it, always. So anything a sheet-hosted page links back to on
`app.huddle.fitness` is a signed-out web app in the sheet. Stripe's Customer Portal is the case
that exists: the app asks `POST /portal-session?returnTo=app`, and the portal's "Return to Huddle"
lands on `/billing-done`, a public page that says to close the sheet (its top-left button: an X on
iOS 26, "Done" before). It has **no link back into the web app** -- that link would be the
signed-out copy -- and no "open the app" button, since the app is already behind the sheet. That
path is deliberately **not** in the association file, so iOS keeps it in the sheet. Coming back is
noticed by `openExternal`'s `onClose`, never by a page or a visibility event.

## WebView settings (`capacitor.config.json`)

- **`ios.allowsLinkPreview: false`.** WKWebView's default previews a link on long press, and the
  tab bar is links, so a long press on History previewed an internal `capacitor://localhost` page.
- Capacitor sets `scrollView.bounces = false` itself. Nothing here needs the bounce:
  `PullToRefresh` measures finger distance, not overscroll.
- `capacitorConfig.test.js` pins the values with their reasons.

## The app build has no service worker, and that is correct

`vite build --mode native` passes `disable: true` to VitePWA. WKWebView will not run a service
worker on `capacitor://`, and on Android one would serve the previous bundle after a store update.
The app does not need one: its files are on the device, so offline cold boot never depends on a
precache. `virtual:pwa-register` stays importable as a no-op, so `main.jsx` and the update banner
are the same code on both builds. **Updates reach the app only through the store** (see the
version-skew rules once they land).

## `config.json` is baked in, and `NATIVE_API_URL` has no default

`scripts/write-native-config.mjs` writes `dist/config.json` after the build. It refuses to run
without an `https://` `NATIVE_API_URL`, deliberately: a store binary pointed at the wrong backend
is not a redeploy away from fixed.

## Keyboard: `resize: "native"`, plus `keepFocusedFieldVisible`

**`"none"` is NOT "leave it to WKWebView".** `@capacitor/keyboard` removes WKWebView's own keyboard
observers on load (so its resize modes can work), and WebKit's "scroll the focused field into
view" goes with them. Under `"none"` nothing replaces it: the first TestFlight build (2026-10-24)
left the login form's fields under the keyboard with no way to see them. Don't go back to it.

- **`"native"` shrinks the WebView to end at the top of the keyboard.** A short screen re-centres
  in what is left (the login form). The cost: `vh`/`dvh` change while typing, and the fixed
  `SessionBar` rides on top of the keyboard instead of hiding behind it, as in most native apps.
- **`keepFocusedFieldVisible`** (`lib/native/keyboard.js`, mounted by `FocusedFieldKeeper` in
  `App.jsx`) covers longer pages: on `keyboardDidShow`, and on `focusin` (moving between fields
  with the keyboard up fires no keyboard event), a field that is off screen or under the
  `SessionBar` (`--bottom-bar-height`) is scrolled to the centre. A field already in view never
  moves.
- **Still to confirm on a device:** the Log screen's weight and reps fields with a workout running
  (the `SessionBar` case), and a long modal such as Contact Us.

## The app draws under the status bar; the page leaves room with `--safe-top`

Capacitor's WebView fills the whole screen, so the page starts **behind** the iOS clock, signal and
battery. Safari and the home-screen web app start it below the status bar, where
`env(safe-area-inset-top)` is 0, so none of this changes the web. The first TestFlight build drew
the Huddle header and the account menu under the clock (2026-10-24).

- `body` is padded by `--safe-top`, and `body::before` is an opaque strip of that height
  (`--z-status-bar`, above the chrome and below every scrim) so content scrolling up under the clock
  stays out of it.
- `.app-chrome` sticks at `top: var(--safe-top)`, and `--sticky-chrome-clearance` includes it.
- **Never write `100vh` for a screen-filling box; use `var(--viewport-min-height)`.** With the body
  padded, a bare `100vh` overflows by the status bar's height and the page scrolls on screens that
  should fit. **Never `top: 0` for new sticky or fixed chrome**; use `var(--safe-top)`.

## The iOS project is committed; its web copy is not

`frontend/ios/` is committed. `ios/App/App/public/` and the generated `capacitor.config.json`
inside it are gitignored and come from `npx cap sync ios`, so **every build runs
`build:native` then `cap sync ios` first**. After adding or removing a Capacitor plugin, run
`npx cap sync ios` and commit the regenerated `ios/App/CapApp-SPM/Package.swift`.

`PrivacyInfo.xcprivacy` is the app target's privacy manifest (Capacitor and each plugin ship their
own). **It must agree with App Store Connect's App Privacy answers** (`docs/app-store-submission.md`):
a new kind of data the app sends to the server means a new entry in both.

`Info.plist` declares `ITSAppUsesNonExemptEncryption = false`: Huddle uses only HTTPS, which is
exempt, and declaring it skips App Store Connect's export-compliance question on every upload.

## Launch: one background colour from the launch screen to the first frame

The launch image (`Splash.imageset`), the WebView and its window are all the page's `--color-bg`
(`#faf9f7` light, `#171614` dark) via the `LaunchBackground` colour set and `MainViewController`
(Capacitor's bridge, subclassed only to paint those backgrounds; `SceneDelegate` instantiates it).
Capacitor's default is the system white/black, which flashes against both.

- **The splash is never held until the page renders.** `@capacitor/splash-screen` keeps its
  default auto-hide. Holding it for a `hide()` call from JS would mean a bundle that fails to boot
  sits behind the splash forever, hiding `boot-watchdog.js`'s fallback. Matching colours removes
  the flash without making the splash something boot has to dismiss.
- **The status bar needs no code.** The app follows the system appearance only (no in-app theme
  switch), and iOS already picks dark or light status-bar text for it. If an in-app theme override
  is ever added, it must drive `@capacitor/status-bar` from `lib/native`.
- **The icon PNGs must be opaque (RGB).** App Store Connect rejects an app icon with an alpha
  channel. `AppIcon.appiconset` holds the 1024px light icon (the PWA's white tile) and an iOS 18
  dark variant (the dark tile from `public/icon.svg`); both are rendered from the brand geometry,
  never hand-drawn (see `docs/brand/README.md`).
- `MainViewController.swift` is registered in `project.pbxproj` by hand (no Xcode here). A new
  Swift file needs the same four entries (PBXBuildFile, PBXFileReference, the App group, Sources),
  and `mobile-ci` is what proves it compiles.

## `mobile-ci.yml`: does the app build and start?

There is no Mac here. The workflow builds unsigned for the simulator, boots the newest iPhone and
iPad, and uploads light/dark screenshots plus `*-console.log`. **The console comes from
`simctl launch --stdout/--stderr`, not `log show`** (never `--console-pty`, which took the app down
with it when backgrounded): Capacitor prints the WebView console to stdout, so the unified log never
contains it.

- **"It starts" is read off the screen, not the console.** A healthy boot logs nothing, so the
  console cannot tell a working app from a blank one. `scripts/ios-maestro.sh` runs
  `e2e/mobile/launch.yaml` with Maestro, which reads the WebView through iOS accessibility: a
  fresh install must reach "Log in" and must not show `boot-watchdog.js`'s "Huddle couldn't load".
  Keep that flow account-free and secret-free; it runs on every push.
- **It gates TestFlight.** `mobile-release.yml` calls it (`workflow_call`) and its `ios` job
  `needs:` it, so a beta that can't start is never uploaded. On push it is still not a required
  check (macOS runners are slow and flakier); a red run there must not block an unrelated web fix.
- **Its concurrency group includes `github.workflow`**, which under `workflow_call` is the caller's
  name. Sharing push's group on `main` would let a newer pending push run cancel a release's gate.
- Maestro is installed from its GitHub release with a pinned SHA-256 (`MAESTRO_VERSION` /
  `MAESTRO_SHA256` in `.github/actions/ios-simulator-app`, which both mobile workflows build
  through); bump both together, never pipe the install script to bash.
- **Maestro runs on a FRESH simulator** (`simctl create`, same model and runtime as the newest
  iPhone), never the one the screenshot step just used. Re-booting that one is where Maestro's
  XCTest driver hung on its first app launch and the simulator's launch service died ("(ipc/mig)
  server died", Xcode 26.3 / iOS 26.2), failing good and broken builds alike before any step ran.
  `ios-maestro.sh` retries once **only** on "iOS driver not ready"; a flow that ran and failed is
  never retried. Its `--debug-output` (XCTest runner logs) is in the artifact.
- **Proven both ways before it gated anything:** a deliberately broken boot failed on `"Log in" is
  visible`, and a good build passed in about a minute. A gate that can't fail guards nothing.

## `mobile-flows.yml`: the app, signed in, on the simulator

`e2e/mobile/flows/` drives the real app against lower through what only the app can break:

| Flow | What it pins |
|---|---|
| `01-sign-in-and-log-a-set` | Login fields and the reps field stay above the keyboard (and the `SessionBar`) while typing |
| `02-background-and-relaunch` | Background → back, and killed → relaunched: still signed in, workout intact |
| `03-checkout-return-link` | The scheme link lands on Billing, a tab tap **leaves it** (#423), no price shows (billing fails closed with no storefront) |
| `04-in-app-browser-sheet` | Terms opens in the sheet; closing it returns to the same screen |
| `05-export-share-sheet` | Export opens the share sheet; dismissing it is not an error |
| `06-history-pull-to-refresh` | History survives the pull (on only in installed apps, so no Playwright spec drives it) |

- **Scope: critical path plus what differs from the web.** Everything else is the same React code
  the Playwright suite already covers; don't port specs here.
- **Each flow starts from `subflows/sign-in.yaml` (a fresh install), so each stands alone.**
  Maestro promises no order. The household comes from `seed-household.mjs` (register → test-support
  code → confirm, via the API), so the welcome modal is never armed.
- **Not on push.** It needs `E2E_TEST_SUPPORT_KEY_LOWER`, kept in the `mobile-e2e` environment
  (any branch) apart from the signing secrets (main only). Dispatch it, or `mobile-release.yml`
  calls it.
- **Non-blocking for now:** the release runs it beside the upload, and nothing `needs:` it. Make the
  `ios` job need it once it has a track record.
- **What it cannot see** (the on-device checklist keeps these): universal links (the unsigned build
  has no Associated Domains), a real Stripe purchase, Password AutoFill, haptics, keep-awake, the
  real App Store storefront, and hard offline (the simulator shares the Mac's network).
- Text matches are regexes; section labels use `(?i)` because they are `text-transform: uppercase`.

## Releasing: `mobile-release.yml` + fastlane (first ran green 2026-10-24)

Manual dispatch only, from a protected GitHub Environment per target (`mobile-lower`,
`mobile-production`). Never trigger it on `push`/`pull_request`: the repo is public and those
secrets sign and upload as Huddle.

- **One project, two apps.** The bundle id and the home-screen name are build settings
  (`PRODUCT_BUNDLE_IDENTIFIER`, `APP_DISPLAY_NAME`), overridden per variant by the Fastfile; the
  committed project is the production app. Don't fork the Xcode project per environment.
- **Version and build number are set ONCE, in the workflow**, and reach both the JS bundle
  (`build:native` bakes them into `APP_BUILD` / `X-Huddle-Client`) and `xcodebuild`. The build
  number is `github.run_number` — monotonic, as both stores require. Never set either by hand in
  the project.
- **The Fastfile is plumbing.** What gets built is decided in the workflow and npm scripts, so
  another build service (Capawesome Cloud is the fallback; Appflow is end-of-life) can replace
  fastlane without moving any decision.
- **`Gemfile.lock` is committed** (from the first release run, 2026-10-24), so every release
  installs the same gems. There is no Ruby here: after bumping fastlane in the `Gemfile`, commit the
  lock the next run uploads as its `gemfile-lock` artifact.

