import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false }));
const login = vi.hoisted(() => vi.fn());

vi.mock('../../config', () => ({
  getSocialSignInConfig: () => ({
    google: { webClientId: 'web.apps.googleusercontent.com', iosClientId: 'ios.apps.googleusercontent.com' },
  }),
}));
vi.mock('./platform', () => ({ isNativeApp: () => platform.native }));
vi.mock('@capgo/capacitor-social-login', () => ({
  SocialLogin: { initialize: vi.fn(async () => {}), login },
}));

// A token-shaped string with this payload. Unsigned: givenNameFromIdToken is only a form prefill
// and never checks a signature (the backend verifies the real token).
function idToken(payload) {
  const part = (o) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'RS256' })}.${part(payload)}.sig`;
}

// Apple sends the person's name beside its token (first sign-in only); Google never does -- the name
// is the token's own given_name claim. Before this, a Google sign-up met an EMPTY name field on both
// the web and the app, while Apple's was filled in.
describe("Google sign-up pre-fills the person's name from the token", () => {
  let adapter;
  let appendChild;

  beforeEach(async () => {
    vi.resetModules();
    platform.native = false;
    login.mockReset();
    appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
      queueMicrotask(() => el.onload?.());
      return el;
    });
    adapter = await import('./socialSignIn');
  });
  afterEach(() => {
    appendChild.mockRestore();
    delete window.google;
  });

  it('reads given_name, including base64url and non-ASCII names', () => {
    expect(adapter.givenNameFromIdToken(idToken({ given_name: 'Nate' }))).toBe('Nate');
    expect(adapter.givenNameFromIdToken(idToken({ given_name: 'Zoë ~?>' }))).toBe('Zoë ~?>');
  });

  it('gives nothing, never throws, for a token without a usable name', () => {
    expect(adapter.givenNameFromIdToken(idToken({ sub: '1' }))).toBeUndefined();
    expect(adapter.givenNameFromIdToken(idToken({ given_name: '  ' }))).toBeUndefined();
    expect(adapter.givenNameFromIdToken('not-a-token')).toBeUndefined();
    expect(adapter.givenNameFromIdToken(undefined)).toBeUndefined();
  });

  it("on the web, Google's button hands the name over with its token", async () => {
    let callback;
    window.google = {
      accounts: { id: { initialize: vi.fn((opts) => { callback = opts.callback; }), renderButton: vi.fn() } },
    };
    const onToken = vi.fn();
    adapter.renderGoogleButton(document.createElement('div'), { onToken });
    await vi.waitFor(() => expect(callback).toBeTypeOf('function'));

    const credential = idToken({ given_name: 'Nate' });
    callback({ credential });
    expect(onToken).toHaveBeenCalledWith(expect.objectContaining({ idToken: credential, givenName: 'Nate' }));
  });

  it("in the app, Google's sign-in hands the name over, from the token when the plugin has none", async () => {
    platform.native = true;
    login.mockResolvedValue({ result: { idToken: idToken({ given_name: 'Nate' }) } });
    expect((await adapter.signInWithProvider('google')).givenName).toBe('Nate');

    login.mockResolvedValue({ result: { idToken: idToken({ given_name: 'Nate' }), profile: { givenName: 'Nathan' } } });
    expect((await adapter.signInWithProvider('google')).givenName).toBe('Nathan');
  });

  it("leaves Apple's name to Apple: never read from its token", async () => {
    platform.native = true;
    login.mockResolvedValue({ result: { idToken: idToken({ given_name: 'Nate' }), profile: {} } });
    expect((await adapter.signInWithProvider('apple')).givenName).toBeUndefined();
  });
});
