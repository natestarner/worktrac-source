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

// The web origin whose /embed/youtube.html the app frames for how-to videos. A YouTube player
// framed straight from capacitor://localhost refuses to play (error 153), so the app frames the web
// host's copy, which YouTube sees as an ordinary https embedder. NATIVE_EMBED_ORIGIN wins;
// otherwise it is the API's host with "api." swapped for "app." (api.huddle.fitness ->
// app.huddle.fitness, api.dev.huddle.fitness -> app.dev.huddle.fitness). Required like the API: a
// store binary that cannot play its videos is not a redeploy away from fixed.
const derived = /^https:\/\/api\./.test(apiUrl) ? apiUrl.replace(/^https:\/\/api\./, 'https://app.') : '';
const embedOrigin = (process.env.NATIVE_EMBED_ORIGIN || derived).replace(/\/+$/, '').replace(/^(https:\/\/[^/]+).*$/, '$1');
if (!/^https:\/\/[^/]+$/.test(embedOrigin)) {
  console.error('write-native-config: set NATIVE_EMBED_ORIGIN to the web app origin (https://app...).');
  process.exit(1);
}

// Sign in with Apple / Google (lib/native/socialSignIn.js). OPTIONAL, unlike the two above: unset,
// the app offers no provider buttons, which is exactly today's app. The release workflow sets them
// per environment once the console setup is done (docs/social-sign-in-setup.md):
//   NATIVE_GOOGLE_IOS_CLIENT_ID  the iOS OAuth client for THIS app's bundle id. Also needs its
//                                reversed id as a URL scheme in Info.plist, or Google's sheet can't
//                                hand the result back to the app.
//   NATIVE_APPLE_SIGN_IN=1       only once the bundle's App ID has the Sign In with Apple capability
//                                AND App.entitlements carries com.apple.developer.applesignin --
//                                Apple's sheet fails without both.
const socialSignIn = {};
const googleIosClientId = (process.env.NATIVE_GOOGLE_IOS_CLIENT_ID || '').trim();
if (googleIosClientId) socialSignIn.google = { iosClientId: googleIosClientId };
if (process.env.NATIVE_APPLE_SIGN_IN === '1') socialSignIn.apple = {};

writeFileSync(
  new URL('../dist/config.json', import.meta.url),
  JSON.stringify({
    apiUrl: apiUrl.replace(/\/+$/, ''),
    embedOrigin,
    ...(Object.keys(socialSignIn).length ? { socialSignIn } : {}),
  }, null, 2) + '\n'
);
console.log(`write-native-config: dist/config.json -> ${apiUrl}, videos from ${embedOrigin}`
  + `, sign in with: ${Object.keys(socialSignIn).join(', ') || 'none'}`);
