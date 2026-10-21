import { describe, expect, it } from 'vitest';
import { APP_BUILD, CLIENT_ID, NATIVE_BUILD_NUMBER, formatAppBuild, formatClientId, parseBuildNumber } from './appBuild';

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

describe('client id and build number', () => {
  it('reads the build number out of the store version, and has none on the web', () => {
    expect(parseBuildNumber('1.4.0 (57)')).toBe(57);
    expect(parseBuildNumber('')).toBeNull();
    // Vitest is the web build.
    expect(NATIVE_BUILD_NUMBER).toBeNull();
  });

  it('names the platform and version in the app, and the build instant on the web', () => {
    expect(formatClientId('1.4.0 (57)', 'ios', '2026-10-21 01:00')).toBe('ios/1.4.0+57');
    expect(formatClientId('', 'web', '2026-10-21 01:00')).toBe('web/2026-10-21T01:00');
    expect(CLIENT_ID).toMatch(/^web\//);
  });

  // RequestDiagnosticsFilter#sanitizeClient drops anything else; a dropped id is a blind spot.
  it('only ever produces characters the server keeps, within its 40-character limit', () => {
    for (const id of [
      formatClientId('1.4.0 (57)', 'ios', '2026-10-21 01:00'),
      formatClientId('', 'web', '2026-10-21 01:00'),
      formatClientId('10.123.4567-beta.1 (123456)', 'android', '2026-10-21 01:00'),
    ]) {
      expect(id).toMatch(/^[A-Za-z0-9._+/:-]{1,40}$/);
    }
  });
});
