import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ native: false, platform: 'web', requestReview: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => env.native,
    getPlatform: () => env.platform,
  },
  registerPlugin: () => ({ requestReview: (...args) => env.requestReview(...args) }),
}));

import { appReviewUrl, requestAppReview } from './review';

const LISTING = 'https://apps.apple.com/us/app/huddle-workout-tracker/id6826555272';

beforeEach(() => {
  env.native = false;
  env.platform = 'web';
  env.requestReview.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('requestAppReview', () => {
  it('does nothing on the web', async () => {
    await expect(requestAppReview()).resolves.toBe(false);
    expect(env.requestReview).not.toHaveBeenCalled();
  });

  it("asks Apple's sheet in the App Store app", async () => {
    env.native = true;
    env.platform = 'ios';
    env.requestReview.mockResolvedValue({ requested: true });
    await expect(requestAppReview()).resolves.toBe(true);
    expect(env.requestReview).toHaveBeenCalledTimes(1);
  });

  it('never throws when the request fails', async () => {
    env.native = true;
    env.platform = 'ios';
    env.requestReview.mockRejectedValue(new Error('no window scene'));
    await expect(requestAppReview()).resolves.toBe(false);
  });

  it('does nothing on Android, which has no plugin', async () => {
    env.native = true;
    env.platform = 'android';
    await expect(requestAppReview()).resolves.toBe(false);
    expect(env.requestReview).not.toHaveBeenCalled();
  });
});

describe('appReviewUrl', () => {
  it('is null on the web, so the web menu has no Rate Huddle', () => {
    expect(appReviewUrl(LISTING)).toBeNull();
  });

  it("is the listing's write-a-review page in the App Store app", () => {
    env.native = true;
    env.platform = 'ios';
    expect(appReviewUrl(LISTING)).toBe(`${LISTING}?action=write-review`);
  });

  it('is null while the listing URL is not configured', () => {
    env.native = true;
    env.platform = 'ios';
    expect(appReviewUrl('')).toBeNull();
    expect(appReviewUrl(undefined)).toBeNull();
    expect(appReviewUrl('not a url')).toBeNull();
  });
});
