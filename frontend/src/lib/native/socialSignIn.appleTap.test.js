import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config', () => ({
  getSocialSignInConfig: () => ({
    apple: { servicesId: 'fitness.huddle.web.lower', redirectUri: 'https://app.dev.huddle.fitness/auth/apple' },
  }),
}));
vi.mock('./platform', () => ({ isNativeApp: () => false }));

// iOS Safari blocks a popup that is not opened inside the tap, and any await before
// AppleID.auth.signIn() ends the tap -- which is how web Apple failed on iPhone with "Sign-in
// failed" while desktop Chrome worked. These pin that, once armed, the click reaches signIn() with
// nothing awaited first, and that every attempt gets a fresh nonce.
describe('web Apple: the popup opens inside the tap', () => {
  let adapter;
  let signIn;
  let init;
  let appendChild;

  beforeEach(async () => {
    vi.resetModules();
    signIn = vi.fn(() => Promise.resolve({ authorization: { id_token: 'id', code: 'code' } }));
    init = vi.fn();
    window.AppleID = { auth: { init, signIn } };
    // jsdom never loads an external script; stand in for Apple's loading at once.
    appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
      queueMicrotask(() => el.onload?.());
      return el;
    });
    adapter = await import('./socialSignIn');
  });
  afterEach(() => {
    appendChild.mockRestore();
    delete window.AppleID;
  });

  it('calls signIn synchronously from the click once armed', async () => {
    await adapter.prepareSignIn('apple');
    expect(init).toHaveBeenCalledTimes(1);

    const result = adapter.signInWithProvider('apple'); // no await yet: this is the tap
    expect(signIn).toHaveBeenCalledTimes(1);

    const token = await result;
    const hashed = init.mock.calls[0][0].nonce;
    expect(hashed).toBe(await adapter.sha256Hex(token.nonce));
    expect(token).toMatchObject({ idToken: 'id', appleAuthorizationCode: 'code' });
  });

  it('re-arms with a fresh nonce for the next attempt', async () => {
    await adapter.prepareSignIn('apple');
    const first = await adapter.signInWithProvider('apple');
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(2));

    adapter.signInWithProvider('apple');
    expect(signIn).toHaveBeenCalledTimes(2); // armed again, so synchronous again
    expect(init.mock.calls[1][0].nonce).not.toBe(init.mock.calls[0][0].nonce);
    expect(init.mock.calls[1][0].nonce).not.toBe(await adapter.sha256Hex(first.nonce));
  });

  it("still works when tapped before arming finished, and names Apple's error when it fails", async () => {
    signIn.mockRejectedValueOnce({ error: 'popup_blocked_by_browser' });
    await expect(adapter.signInWithProvider('apple')).rejects.toMatchObject({
      cancelled: false,
      message: 'Sign-in failed (popup_blocked_by_browser)',
    });
  });

  it('treats a closed popup as a cancellation', async () => {
    await adapter.prepareSignIn('apple');
    signIn.mockRejectedValueOnce({ error: 'popup_closed_by_user' });
    await expect(adapter.signInWithProvider('apple')).rejects.toMatchObject({ cancelled: true });
  });
});
