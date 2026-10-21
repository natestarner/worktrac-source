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

// The store build number (57), or null on the web, which has no build to fall behind.
export function parseBuildNumber(version) {
  const match = /\((\d+)\)\s*$/.exec(version ?? '');
  return match ? Number(match[1]) : null;
}
export const NATIVE_BUILD_NUMBER = parseBuildNumber(APP_VERSION);

// Sent as X-Huddle-Client on every request (api/client.js) and logged beside each line on the
// server, so "which App Store builds are still calling us?" has an answer before anything is
// removed from the API. App: "ios/1.4.0+57". Web: "web/2026-10-21T01:00". Only characters the
// server's sanitizer keeps (RequestDiagnosticsFilter#sanitizeClient), so it is never dropped there.
export function formatClientId(version, platform, instant) {
  if (version) {
    const build = parseBuildNumber(version);
    const marketing = version.replace(/\s*\(\d+\)\s*$/, '');
    return `${platform}/${marketing}${build === null ? '' : `+${build}`}`.slice(0, 40);
  }
  return `web/${instant.replace(' ', 'T')}`.slice(0, 40);
}
export const CLIENT_ID = formatClientId(APP_VERSION, nativePlatform(), BUILD_INSTANT);
