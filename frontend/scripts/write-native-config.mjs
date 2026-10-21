// Writes dist/config.json for the app build (`npm run build:native`).
//
// The web build has no config.json of its own: CI deletes it from the artifact and the deploy
// writes one per environment. An app has no deploy step, so the API origin is baked in here as a
// local file -- which also means loadConfig() can never fail inside the app, and its last-known
// fallback goes unused.
//
// NATIVE_API_URL is required, with no default: an app pointed at the wrong backend would be a
// signed binary in a store, not a redeploy away from fixed. The release workflow sets it per
// environment (Huddle Lower -> lower, Huddle -> production).
import { writeFileSync } from 'node:fs';

const apiUrl = process.env.NATIVE_API_URL;
if (!apiUrl || !/^https:\/\//.test(apiUrl)) {
  console.error('write-native-config: set NATIVE_API_URL to the backend origin (https://...).');
  process.exit(1);
}

writeFileSync(
  new URL('../dist/config.json', import.meta.url),
  JSON.stringify({ apiUrl: apiUrl.replace(/\/+$/, '') }, null, 2) + '\n'
);
console.log(`write-native-config: dist/config.json -> ${apiUrl}`);
