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
  afterEach(async () => {
    // Every tap re-arms Apple in the background, and nothing in a test waits for it. Each test gets a
    // fresh module (resetModules) but window.AppleID is shared, so a re-arm still running when a test
    // ends calls the NEXT test's init mock. On a slow CI runner (2026-11-21) test 1's did: it
    // satisfied test 2's "init called twice" before test 2's own re-arm had finished, so test 2's
    // second tap wasn't armed ("called 1 times"), and that tap later used up test 3's rejection
    // ("resolved instead of rejecting"). Reproduced exactly by holding test 1's re-arm until test 2's
    // mocks were in place. prepareSignIn returns the arming in flight (or arms once more), so this
    // drains it while this test's mocks are still the ones installed.
    await adapter.prepareSignIn('apple').catch(() => {});
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
    // Plain words that say what to do, with Apple's own code kept apart for support.
    await expect(adapter.signInWithProvider('apple')).rejects.toMatchObject({
      cancelled: false,
      signInFailure: true,
      code: 'popup_blocked_by_browser',
      message: 'Your browser blocked the Apple sign-in window. Allow pop-ups for Huddle, then try again.',
    });
  });

  it("an Apple code with no advice of its own still reads as plain words, and keeps the code", async () => {
    await adapter.prepareSignIn('apple');
    signIn.mockRejectedValueOnce({ error: 'invalid_request' });
    await expect(adapter.signInWithProvider('apple')).rejects.toMatchObject({
      cancelled: false,
      signInFailure: true,
      code: 'invalid_request',
      message: "Apple couldn't finish signing you in. Please try again.",
    });
  });

  it("says Apple couldn't be reached when its script never arrives", async () => {
    // A content blocker or no signal: the script tag fails, so there is no sheet to open.
    appendChild.mockImplementation((el) => {
      queueMicrotask(() => el.onerror?.(new Event('error')));
      return el;
    });
    await expect(adapter.signInWithProvider('apple')).rejects.toMatchObject({
      cancelled: false,
      signInFailure: true,
      code: 'script_load_failed',
      message: "Couldn't reach Apple. Check your connection and try again.",
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('treats a closed popup as a cancellation', async () => {
    await adapter.prepareSignIn('apple');
    signIn.mockRejectedValueOnce({ error: 'popup_closed_by_user' });
    await expect(adapter.signInWithProvider('apple')).rejects.toMatchObject({ cancelled: true });
  });
});
