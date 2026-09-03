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
export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';
