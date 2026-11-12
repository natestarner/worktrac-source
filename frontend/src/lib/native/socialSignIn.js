// Sign in with Apple / Google: getting an ID token from the provider. Everything after the token
// (the request to our backend, the session) is one code path on every platform; only HOW the token
// is obtained differs, and that difference lives here, beside the other platform adapters.
//
//   Web    Google: Google Identity Services' own rendered button (renderGoogleButton).
//          Apple:  Apple's JS, popup mode.
//   App    Both: @capgo/capacitor-social-login, the native sheets. Google refuses its web sign-in
//          inside an embedded web view (disallowed_useragent), so the app can never fall back to
//          the web flow.
//   Test   The e2e suite's stand-in (`test` in config.json + a hook Playwright installs).
//
// THE NONCE CONTRACT (docs/architecture/social-sign-in.md): we generate a raw nonce, give the
// provider sha256(raw) as lower-case hex, and send the backend the RAW value with the token. A token
// is only accepted when its nonce is the hash of what we send, so a token lifted from a log or a
// proxy is useless on its own.
//
// Scripts load lazily, when a screen with a button mounts, and never at boot or into the service
// worker's precache. When one can't load (offline, a content blocker), that provider simply offers
// no button; password sign-in is unaffected.
import { getSocialSignInConfig } from '../../config';
import { isNativeApp } from './platform';

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

/** A fresh raw nonce and the hash the provider is given. */
export async function createNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed: await sha256Hex(raw) };
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The providers this build and environment can offer, in display order. Apple first: App Review
 * expects it to be at least as prominent as any other provider.
 */
export function availableSignInProviders() {
  const config = getSocialSignInConfig();
  const providers = [];
  if (config.apple && (isNativeApp() || config.apple.servicesId)) providers.push('apple');
  if (config.google && (isNativeApp() ? config.google.iosClientId : config.google.webClientId)) {
    providers.push('google');
  }
  // The test provider needs BOTH its config flag and Playwright's hook, so a stray `test: true` in a
  // deployed config.json still offers nothing to a real person.
  if (config.test && typeof window !== 'undefined' && typeof window.__huddleTestIdentityProvider === 'function') {
    providers.push('test');
  }
  return providers;
}

/**
 * True where Google's sign-in must be Google's own rendered button (the web), so the caller mounts
 * it with renderGoogleButton instead of drawing a button of its own.
 */
export function googleUsesRenderedButton() {
  return !isNativeApp();
}

/**
 * Asks the provider who this is.
 *
 * @returns {Promise<{ idToken: string, nonce: string, appleAuthorizationCode?: string,
 *   appleRedirectUri?: string, givenName?: string }>} `nonce` is the RAW value, for the backend.
 * @throws an Error with `cancelled: true` when the person closed the sheet -- not an error to show.
 */
export async function signInWithProvider(provider) {
  // Web Apple first and with no await before it: see webApple.
  if (provider === 'apple' && !isNativeApp()) return webApple();
  const nonce = await createNonce();
  if (provider === 'test') return testProvider(nonce);
  if (isNativeApp()) return nativeSignIn(provider, nonce);
  // Web Google has no imperative entry point -- see renderGoogleButton.
  throw new Error('Google sign-in on the web goes through its own button');
}

/**
 * Mounts Google's own button into `container` (the web only). Calls onToken with the same shape as
 * signInWithProvider, or onError when the script can't load. Returns a cleanup function.
 */
export function renderGoogleButton(container, { onToken, onError, text = 'continue_with' }) {
  let cancelled = false;
  (async () => {
    try {
      const { webClientId } = getSocialSignInConfig().google ?? {};
      await loadScript(GOOGLE_SCRIPT);
      if (cancelled) return;
      const nonce = await createNonce();
      window.google.accounts.id.initialize({
        client_id: webClientId,
        nonce: nonce.hashed,
        // The ID token straight back to this page; no redirect, no cookie on our side.
        callback: (response) => {
          if (response?.credential) onToken({ idToken: response.credential, nonce: nonce.raw });
        },
        use_fedcm_for_button: true,
        itp_support: true,
      });
      window.google.accounts.id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text,
        shape: 'rectangular',
        logo_alignment: 'center',
        width: Math.min(container.clientWidth || 320, 400),
      });
    } catch (error) {
      if (!cancelled) onError?.(error);
    }
  })();
  return () => {
    cancelled = true;
  };
}

// THE POPUP MUST OPEN INSIDE THE TAP. iOS Safari blocks a window.open that is not part of the
// user's gesture, and an await (loading Apple's script, hashing the nonce) ends the gesture -- so
// the old "load, hash, init, then signIn" failed on iPhone with "Sign-in failed" while desktop
// Chrome, which allows ~5s of grace, worked. So Apple is ARMED ahead of time (script loaded, a
// fresh nonce hashed, init called) when its button mounts (prepareSignIn), and the click calls
// AppleID.auth.signIn() synchronously. A nonce is single-use, so every attempt re-arms with a new
// one. Clicked before arming finished (a slow script), it arms then and tries anyway: fine on
// desktop browsers, and no worse than before on iOS.
let appleArmed = null; // the raw + hashed nonce Apple's init currently holds, or null
let appleArming = null;

/** Readies a provider whose sheet must open within the tap (web Apple). Safe to call repeatedly. */
export function prepareSignIn(provider) {
  if (provider !== 'apple' || isNativeApp()) return Promise.resolve();
  return armApple();
}

function armApple() {
  if (appleArmed) return Promise.resolve();
  if (!appleArming) {
    appleArming = (async () => {
      const { servicesId, redirectUri } = getSocialSignInConfig().apple ?? {};
      await loadScript(APPLE_SCRIPT);
      const nonce = await createNonce();
      window.AppleID.auth.init({
        clientId: servicesId,
        scope: 'name email',
        redirectURI: redirectUri,
        nonce: nonce.hashed,
        usePopup: true,
      });
      appleArmed = nonce;
    })().finally(() => {
      appleArming = null;
    });
  }
  return appleArming;
}

async function webApple() {
  if (!appleArmed) await armApple();
  const nonce = appleArmed;
  appleArmed = null;
  // Called before any await on the armed path, so Safari counts it as part of the tap.
  const pending = window.AppleID.auth.signIn();
  // Arm the next attempt now. A failure here is safe to drop: that next tap arms again itself and
  // reports whatever it gets.
  armApple().catch(() => {});
  const { redirectUri } = getSocialSignInConfig().apple ?? {};
  let response;
  try {
    response = await pending;
  } catch (error) {
    // Apple's popup reports a closed window as { error: 'popup_closed_by_user' }. Anything else
    // carries Apple's own code into the message, so a report from a phone says what happened.
    const isCancel = error?.error === 'popup_closed_by_user' || error?.error === 'user_cancelled_authorize';
    const failure = cancellation(isCancel, error);
    if (!isCancel && error?.error) failure.message = `Sign-in failed (${error.error})`;
    throw failure;
  }
  return {
    idToken: response.authorization.id_token,
    nonce: nonce.raw,
    appleAuthorizationCode: response.authorization.code,
    appleRedirectUri: redirectUri,
    givenName: response.user?.name?.firstName,
  };
}

let nativeInitialized = false;

async function nativeSignIn(provider, nonce) {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!nativeInitialized) {
    const config = getSocialSignInConfig();
    await SocialLogin.initialize({
      ...(config.google?.iosClientId
        ? { google: { iOSClientId: config.google.iosClientId, mode: 'online' } }
        : {}),
      // useProperTokenExchange: hands back Apple's one-time authorization code untouched (the
      // plugin does NOT exchange it on the device), which the backend needs to revoke Huddle's
      // Apple sign-in when an account is deleted.
      ...(config.apple ? { apple: { useProperTokenExchange: true } } : {}),
    });
    nativeInitialized = true;
  }
  let login;
  try {
    login = await SocialLogin.login({
      provider,
      options: provider === 'apple'
        ? { scopes: ['name', 'email'], nonce: nonce.hashed }
        : { scopes: ['email', 'profile'], nonce: nonce.hashed },
    });
  } catch (error) {
    throw cancellation(/cancel/i.test(String(error?.message ?? error)), error);
  }
  const result = login.result ?? {};
  if (!result.idToken) throw new Error(`${provider} returned no ID token`);
  return {
    idToken: result.idToken,
    nonce: nonce.raw,
    appleAuthorizationCode: provider === 'apple' ? result.authorizationCode : undefined,
    givenName: provider === 'apple' ? result.profile?.givenName ?? undefined : undefined,
  };
}

// The e2e stand-in. Playwright installs window.__huddleTestIdentityProvider, which mints a token
// from the backend's test provider (local/lower only, behind the e2e key) for the raw nonce.
async function testProvider(nonce) {
  const hook = window.__huddleTestIdentityProvider;
  if (typeof hook !== 'function') throw new Error('The test identity provider is not installed');
  const { idToken, cancelled } = await hook({ nonce: nonce.raw });
  if (cancelled) throw cancellation(true);
  return { idToken, nonce: nonce.raw };
}

function cancellation(isCancel, cause) {
  const error = new Error(isCancel ? 'Sign-in cancelled' : 'Sign-in failed');
  error.cancelled = Boolean(isCancel);
  error.cause = cause;
  return error;
}

const loading = new Map();

function loadScript(src) {
  if (loading.has(src)) return loading.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Forget the failure so a later screen (back online) can try again.
      loading.delete(src);
      script.remove();
      reject(new Error(`Couldn't load ${src}`));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}
