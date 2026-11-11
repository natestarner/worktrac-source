import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config', () => ({ getSocialSignInConfig: vi.fn() }));
vi.mock('./platform', () => ({ isNativeApp: vi.fn(() => false) }));

import { getSocialSignInConfig } from '../../config';
import { isNativeApp } from './platform';
import {
  availableSignInProviders,
  createNonce,
  googleUsesRenderedButton,
  sha256Hex,
  signInWithProvider,
} from './socialSignIn';

describe('sign in with Apple / Google: the adapter', () => {
  beforeEach(() => {
    isNativeApp.mockReturnValue(false);
    getSocialSignInConfig.mockReturnValue({});
    delete window.__huddleTestIdentityProvider;
  });
  afterEach(() => {
    delete window.__huddleTestIdentityProvider;
  });

  // The same fixed vector the backend pins (IdTokenVerifierTest#theNonceHashIsLowerCaseHexSha256),
  // so the two sides can never disagree on the encoding of the hash the provider is given.
  it('hashes the nonce as lower-case hex SHA-256, exactly as the backend checks it', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('makes a long random raw nonce and gives the provider only its hash', async () => {
    const a = await createNonce();
    const b = await createNonce();
    expect(a.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(a.raw).not.toBe(b.raw);
    expect(a.hashed).toBe(await sha256Hex(a.raw));
  });

  // Production until launch: no socialSignIn block in config.json, so no button anywhere.
  it('offers nothing when this environment configures no provider', () => {
    expect(availableSignInProviders()).toEqual([]);
  });

  it('offers Apple first, then Google, on the web when both are configured', () => {
    getSocialSignInConfig.mockReturnValue({
      apple: { servicesId: 'fitness.huddle.web', redirectUri: 'https://x/auth/apple' },
      google: { webClientId: 'web.apps.googleusercontent.com' },
    });
    expect(availableSignInProviders()).toEqual(['apple', 'google']);
  });

  it('needs the web ids on the web and the iOS id in the app', () => {
    getSocialSignInConfig.mockReturnValue({ apple: {}, google: { iosClientId: 'ios.apps.googleusercontent.com' } });
    expect(availableSignInProviders()).toEqual([]);
    isNativeApp.mockReturnValue(true);
    expect(availableSignInProviders()).toEqual(['apple', 'google']);
  });

  // A stray `test: true` in a deployed config.json must still offer nothing to a real person.
  it('offers the test provider only when Playwright has installed its hook too', () => {
    getSocialSignInConfig.mockReturnValue({ test: true });
    expect(availableSignInProviders()).toEqual([]);
    window.__huddleTestIdentityProvider = vi.fn();
    expect(availableSignInProviders()).toEqual(['test']);
  });

  it("uses Google's own rendered button on the web and the native sheet in the app", () => {
    expect(googleUsesRenderedButton()).toBe(true);
    isNativeApp.mockReturnValue(true);
    expect(googleUsesRenderedButton()).toBe(false);
  });

  it('asks the test provider with the RAW nonce and hands back the token with it', async () => {
    window.__huddleTestIdentityProvider = vi.fn(async ({ nonce }) => ({ idToken: `token-for-${nonce}` }));
    const result = await signInWithProvider('test');
    expect(result.idToken).toBe(`token-for-${result.nonce}`);
    expect(result.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a closed sheet as a cancellation, not an error to show', async () => {
    window.__huddleTestIdentityProvider = vi.fn(async () => ({ cancelled: true }));
    await expect(signInWithProvider('test')).rejects.toMatchObject({ cancelled: true });
  });
});
