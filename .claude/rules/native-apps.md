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
| `externalLinkProps(url)` / `openExternal(url)` | `target="_blank"` anchor, no `onClick` | In-app browser sheet (SFSafariViewController) | `LegalLinks.jsx`, `BillingTab`'s portal |
| `openInBrowser(url)` | new tab | Leaves for Safari (`@capacitor/app-launcher`). **For a page finished outside the app**: closing the in-app sheet never backgrounds the app, so a return that must be noticed (`useCheckoutResume`'s `visibilitychange`) needs Safari | `BillingTab`'s hosted checkout |
| `nativeHaptic(pattern)` | returns `false`, so `lib/haptics.js` takes its old routes | Apple's haptic engine; still behind the reduced-motion check | `lib/haptics.js` |
| `isInstalledApp()` | `display-mode: standalone` / `navigator.standalone` | always `true` | `PullToRefresh.jsx` (History's pull) |
| `keepScreenAwake()` / `allowScreenSleep()` | no-op | `@capacitor-community/keep-awake` while a workout is on screen; iOS releases it on background | `SessionBar.jsx` (its visibility effect) |
| `scheduleRestNotifications` / `cancelRestNotifications` / `ensureRestNotificationPermission` | no-op | Local notification at the moment each running rest timer fills, scheduled on `visibilitychange: hidden`, cancelled on return; permission asked when a rest timer first starts, never at launch | `hooks/useRestNotifications.js` (mounted in `AppShell`) |
| `listenForAppLinks(onPath)` | no-op (the browser already loaded the URL) | A universal link that opened the app (`appUrlOpen`, or the launch URL on a cold start) becomes an in-app path | `AppLinkRouter.jsx` (mounted in `App.jsx`, outside every route) |

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
2. **The site vouches for the app.** `frontend/public/.well-known/apple-app-site-association`
   names both app IDs (`<TEAMID>.fitness.huddle.app` and `….lower`), because lower and production
   serve the SAME frontend build; each app's entitlement decides which domain it actually claims.
   It claims `/join*`, `/app/*` and `/checkout-complete*` only. **Not yet committed: it needs the
   Team ID** (checklist 1.5).
   - `staticwebapp.config.json` keeps `/.well-known/*` out of the single-page fallback and serves
     the file as JSON; without that exclusion iOS receives `index.html` (`appLinks.test.js` pins it).
   - `ci.yml` uploads the build with `include-hidden-files: true`: `upload-artifact` skips dot
     directories by default, which would drop the file on its way to the deploy repo.
3. **The app routes it.** `listenForAppLinks` → `AppLinkRouter` turns the URL into a path for the
   router. `/checkout-complete` becomes `/app/billing?checkout=<id>`, because that page's "go back to
   the app" is nonsense inside the app. Hosts other than the two web apps are ignored.

Apple fetches the file through its own CDN, so a change can take a day to reach devices.

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

## Keyboard: `resize: "none"` is the Safari-matching setting

Installing `@capacitor/keyboard` applies its default (`native`), which **resizes the WebView**
when the keyboard opens. That moves the bottom-fixed `SessionBar` and changes `vh` mid-typing,
which Safari never does. `"none"` leaves keyboard avoidance to WKWebView itself, as in Safari.
**Not yet verified on a device** (checklist 2.4/9.2): confirm on the Log screen's weight and reps
fields before changing it either way.

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

## `mobile-ci.yml` is the only place the app is seen before TestFlight

There is no Mac here. The workflow builds unsigned for the simulator, boots the newest iPhone and
iPad, and uploads light/dark screenshots plus `*-console.log`. **The console comes from
`simctl launch --stdout/--stderr`, not `log show`** (never `--console-pty`, which took the app down with it when backgrounded): Capacitor prints the WebView console to stdout,
so the unified log never contains it. Not a required check (macOS runners are slow and flakier);
promote it once it has a track record.

## Releasing: `mobile-release.yml` + fastlane (unverified until the Apple account exists)

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
- **No `Gemfile.lock` yet** (no Ruby here). The first run uploads the one it resolved as the
  `gemfile-lock` artifact; commit it, so every later release installs the same gems.

