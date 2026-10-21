// Which build this is, as a UTC "YYYY-MM-DD HH:MM" instant stamped at compile time by
// vite.config.js. package.json is "0.0.0" and no git SHA is available to the frontend build, so the
// build instant is the honest answer to "which deploy am I looking at".
//
// One definition, two consumers -- App Settings shows it, and Contact Us attaches it to a report.
// It was previously a module-local const in ContactTab, which meant the only place a person could
// read their own version was inside a disclosure panel they had to expand while filing a bug.
//
// `typeof` guarded rather than referenced directly: the define is a build-time substitution, so it
// simply does not exist under a bare `vite dev` module graph or in a Vitest run that skips the
// define, and an unguarded reference is a ReferenceError at import time rather than a missing
// string.
import { nativePlatform } from './native';

const BUILD_INSTANT = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

// "1.4.0 (57)" in the App Store app, '' on the web (vite.config.js).
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

// ContactDiagnostics.appBuild is @Size(max = 40) on the server, and a longer value would fail
// validation for the WHOLE message -- a bug report refused because of its own diagnostics. Clamp
// rather than trust every future version string to stay short.
const APP_BUILD_MAX = 40;

export function formatAppBuild(version, platform, instant) {
  const full = version ? `${platform} ${version} ${instant}` : instant;
  return full.slice(0, APP_BUILD_MAX);
}

// Web: "2026-10-21 01:00", exactly as before. App: "ios 1.4.0 (57) 2026-10-21 01:00".
export const APP_BUILD = formatAppBuild(APP_VERSION, nativePlatform(), BUILD_INSTANT);
