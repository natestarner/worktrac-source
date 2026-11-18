import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ native: false, platform: 'web' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => env.native,
    getPlatform: () => env.platform,
  },
  registerPlugin: () => ({}),
}));

import { initialBillingChannel, resolveBillingChannel } from './billingChannel';

beforeEach(() => {
  env.native = false;
  env.platform = 'web';
});

describe('billing channel', () => {
  it('is the embedded checkout on the web, from the very first render', async () => {
    expect(initialBillingChannel()).toBe('embedded');
    await expect(resolveBillingChannel()).resolves.toBe('embedded');
  });

  // Apple: a plan usable in the app is sold in the app, through the App Store, on every storefront.
  it('sells through the store in the App Store app, from the first render', async () => {
    env.native = true;
    env.platform = 'ios';
    expect(initialBillingChannel()).toBe('store');
    await expect(resolveBillingChannel()).resolves.toBe('store');
  });

  // No Google Play plugin yet: closed, not open. Android becomes 'store' by adding its plugin and one
  // line in purchases.js#storeSource.
  it('offers no purchase on Android until it has a store plugin', async () => {
    env.native = true;
    env.platform = 'android';
    expect(initialBillingChannel()).toBe('none');
  });
});
