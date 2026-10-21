---
paths:
  - "frontend/src/lib/native/**"
  - "frontend/ios/**"
  - "frontend/capacitor.config.json"
  - "frontend/vite.config.js"
  - "frontend/scripts/*native*"
  - "frontend/scripts/ios-*"
  - ".github/workflows/mobile-*.yml"
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
| `externalLinkProps(url)` / `openExternal(url)` | `target="_blank"` anchor, no `onClick` | In-app browser sheet (SFSafariViewController) | `LegalLinks.jsx` |
| `nativeHaptic(pattern)` | returns `false`, so `lib/haptics.js` takes its old routes | Apple's haptic engine; still behind the reduced-motion check | `lib/haptics.js` |
| `isInstalledApp()` | `display-mode: standalone` / `navigator.standalone` | always `true` | `PullToRefresh.jsx` (History's pull) |

`APP_BUILD` (`lib/appBuild.js`) is `"<platform> <version> (<build>) <instant>"` in the app and the
bare instant on the web, clamped to **40 characters** because `ContactDiagnostics.appBuild` is
`@Size(max = 40)` and an over-long value would refuse the whole Contact Us message.
`NATIVE_APP_VERSION` / `NATIVE_BUILD_NUMBER` are baked in at `build:native` time, so the release
workflow must pass the same values to `xcodebuild`.

**Deliberately not adapted yet:** `BillingTab`'s Customer Portal `window.open`. Whether that link
may appear at all depends on the App Store storefront (the billing-channels phase), not just on how
it opens.

- Never enable `CapacitorHttp` (it patches `fetch`, changing abort/timeout/CORS semantics on one
  platform only; `api/client.js` is the one HTTP path) and never add `@capacitor/network` (a second
  "am I online?" signal; `useOnlineStatus` is the one).

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
