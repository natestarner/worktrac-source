import { describe, expect, it } from 'vitest';
import { APP_BUILD, formatAppBuild } from './appBuild';

describe('APP_BUILD', () => {
  it('on the web is the build instant alone, exactly as before the app existed', () => {
    expect(formatAppBuild('', 'web', '2026-10-21 01:00')).toBe('2026-10-21 01:00');
    // Vitest runs the web build (no __APP_VERSION__), so the live constant takes the same shape.
    expect(APP_BUILD).not.toMatch(/^web /);
  });

  it('in the app leads with the platform and store version', () => {
    expect(formatAppBuild('1.4.0 (57)', 'ios', '2026-10-21 01:00')).toBe('ios 1.4.0 (57) 2026-10-21 01:00');
  });

  // The server's ContactDiagnostics.appBuild is @Size(max = 40); over it, the whole Contact Us
  // message is refused. A long version must cost the tail of the stamp, never the bug report.
  it('never exceeds the 40 characters the server accepts', () => {
    const long = formatAppBuild('10.123.4567-beta.1 (123456)', 'android', '2026-10-21 01:00');
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.startsWith('android 10.123.4567-beta.1 (123456)')).toBe(true);
  });
});
