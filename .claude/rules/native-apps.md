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

- **Plugins are imported lazily, inside the native branch.** `@capacitor/core` is the only package
  a browser downloads, and on the web `isNativePlatform()` is a constant `false`.
- **A new device capability = a new function in `lib/native`, with a test that pins its web
  branch.** If the web branch is not provably today's behaviour, the change is not invisible on
  the web, and its PR must say so.
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

## `mobile-ci.yml` is the only place the app is seen before TestFlight

There is no Mac here. The workflow builds unsigned for the simulator, boots the newest iPhone and
iPad, and uploads light/dark screenshots plus `*-console.log`. **The console comes from
`simctl launch --console-pty`, not `log show`**: Capacitor prints the WebView console to stdout,
so the unified log never contains it. Not a required check (macOS runners are slow and flakier);
promote it once it has a track record.
