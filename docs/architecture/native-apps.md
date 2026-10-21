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
  an iPhone and an iPad, and uploads screenshots and the app's console. Signed TestFlight/App
  Store builds will come from a separate, manually triggered release workflow.

## What is different from the web, and why it is fine

| | Web (Safari / PWA) | App | Consequence |
|---|---|---|---|
| Service worker | Precaches the shell; silently reloads after a deploy | None | Offline cold boot is *more* reliable in the app (no precache to miss). The "SW silent forced reload" condition doesn't exist there. |
| Updates | Next navigation after a deploy | Only via the App Store | Old builds live for months. Backend changes must stay additive (version-skew rules, Phase 7). |
| `config.json` | Fetched, with a last-known fallback | Local file | Can't fail to load |
| Keyboard | Overlays the page | `Keyboard.resize: "none"` to match | Needs a device check (see the rule file) |
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
