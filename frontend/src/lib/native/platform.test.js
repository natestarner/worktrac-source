import { describe, expect, it } from 'vitest';
import { isNativeApp, nativePlatform } from './index';

// The whole premise of lib/native is that a browser takes today's code path. That rests on
// Capacitor's own answer outside the app shell, so pin it: if a Capacitor upgrade ever started
// reporting a browser as native, every adapter here would silently switch the web onto device code.
describe('lib/native platform detection, outside the app shell', () => {
  it('reports a browser as not native', () => {
    expect(isNativeApp()).toBe(false);
  });

  it("reports the platform as 'web'", () => {
    expect(nativePlatform()).toBe('web');
  });
});
