import { describe, expect, it } from 'vitest';
import infoPlist from '../../../ios/App/App/Info.plist?raw';
import pbxproj from '../../../ios/App/App.xcodeproj/project.pbxproj?raw';
import fastfile from '../../../fastlane/Fastfile?raw';

// Google's iOS sign-in (GoogleSignIn 9, via @capgo/capacitor-social-login) refuses to start unless
// the app registers its client's REVERSED id as a URL scheme. Huddle and Huddle Lower have different
// Google iOS clients, so it is a build setting the Fastfile sets per app, like APP_LINK_DOMAIN.
// Nothing fails at build time if any of these drift: Google's sheet just errors on the device.
const PROD = 'com.googleusercontent.apps.428334695403-4rvt9vdifhuoqv681gufes3qses28j20';
const LOWER = 'com.googleusercontent.apps.428334695403-m6cn7lk9h61hm92ltp6ul014cceoehbs';

describe("Google sign-in's URL scheme in the iOS app", () => {
  it('registers the build setting as a URL scheme', () => {
    expect(infoPlist).toMatch(
      /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>\$\(GOOGLE_REVERSED_CLIENT_ID\)<\/string>/,
    );
  });

  it("defaults to the production app's client in both build configurations", () => {
    const defaults = pbxproj.match(/GOOGLE_REVERSED_CLIENT_ID = ([^;]+);/g) ?? [];
    expect(defaults).toHaveLength(2);
    for (const line of defaults) expect(line).toContain(PROD);
  });

  it('sets each variant its own client in the release build', () => {
    expect(fastfile).toMatch(new RegExp(`"lower" => \\{[^}]*google_scheme: "${LOWER}"`));
    expect(fastfile).toMatch(new RegExp(`"production" => \\{[^}]*google_scheme: "${PROD}"`));
    expect(fastfile).toContain('"GOOGLE_REVERSED_CLIENT_ID=#{v[:google_scheme]}"');
  });
});
