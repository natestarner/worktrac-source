import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ native: false, platform: 'web', getCountryCode: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => env.native,
    getPlatform: () => env.platform,
  },
  registerPlugin: () => ({ getCountryCode: (...args) => env.getCountryCode(...args) }),
}));

import { initialBillingChannel, resolveBillingChannel, resetBillingChannelForTests } from './billingChannel';

beforeEach(() => {
  env.native = false;
  env.platform = 'web';
  env.getCountryCode.mockReset();
  resetBillingChannelForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('billing channel', () => {
  it('is the embedded checkout on the web, from the very first render, without asking anything', async () => {
    expect(initialBillingChannel()).toBe('embedded');
    await expect(resolveBillingChannel()).resolves.toBe('embedded');
    expect(env.getCountryCode).not.toHaveBeenCalled();
  });

  // Fails closed: a purchase button shown to a non-US account is an App Review rejection.
  it('starts the App Store app at "none" until the storefront answers', () => {
    env.native = true;
    env.platform = 'ios';
    expect(initialBillingChannel()).toBe('none');
  });

  it('links out to Stripe on the US storefront', async () => {
    env.native = true;
    env.platform = 'ios';
    env.getCountryCode.mockResolvedValue({ countryCode: 'USA' });
    await expect(resolveBillingChannel()).resolves.toBe('external');
  });

  it('offers no purchase at all on any other storefront', async () => {
    env.native = true;
    env.platform = 'ios';
    env.getCountryCode.mockResolvedValue({ countryCode: 'CAN' });
    await expect(resolveBillingChannel()).resolves.toBe('none');
  });

  it('offers no purchase when the storefront cannot be read, and asks again next time', async () => {
    env.native = true;
    env.platform = 'ios';
    env.getCountryCode.mockRejectedValueOnce(new Error('StoreKit unavailable'));
    await expect(resolveBillingChannel()).resolves.toBe('none');

    env.getCountryCode.mockResolvedValue({ countryCode: 'USA' });
    await expect(resolveBillingChannel()).resolves.toBe('external');
  });

  it('treats a storefront with no country as unknown -- no purchase', async () => {
    env.native = true;
    env.platform = 'ios';
    env.getCountryCode.mockResolvedValue({});
    await expect(resolveBillingChannel()).resolves.toBe('none');
  });

  // No Android storefront plugin yet: closed, not open.
  it('offers no purchase on Android', async () => {
    env.native = true;
    env.platform = 'android';
    await expect(resolveBillingChannel()).resolves.toBe('none');
    expect(env.getCountryCode).not.toHaveBeenCalled();
  });
});
