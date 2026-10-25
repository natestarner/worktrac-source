import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  native: false,
  launchUrl: undefined,
  listeners: [],
  addListener: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => env.native,
    getPlatform: () => (env.native ? 'ios' : 'web'),
  },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (...args) => env.addListener(...args),
    getLaunchUrl: async () => (env.launchUrl ? { url: env.launchUrl } : undefined),
  },
}));

import { appPathForUrl, appReturnUrl, listenForAppLinks, resetLaunchUrlForTests } from './appLinks';
import infoPlist from '../../../ios/App/App/Info.plist?raw';
import webAppConfig from '../../../public/staticwebapp.config.json';
import aasa from '../../../public/.well-known/apple-app-site-association.json';
import entitlements from '../../../ios/App/App/App.entitlements?raw';

// Lets the adapter's async setup (dynamic import, addListener, getLaunchUrl) run to completion.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetLaunchUrlForTests();
  env.native = false;
  env.launchUrl = undefined;
  env.listeners = [];
  env.addListener.mockReset();
  env.addListener.mockImplementation(async (event, fn) => {
    const entry = { event, fn, remove: vi.fn() };
    env.listeners.push(entry);
    return entry;
  });
});

describe('appPathForUrl', () => {
  it('keeps an invitation link whole, so Join gets its invitation', () => {
    expect(appPathForUrl('https://app.huddle.fitness/join?i=42&t=abc')).toBe('/join?i=42&t=abc');
  });

  it('routes the lower web app the same way', () => {
    expect(appPathForUrl('https://app.dev.huddle.fitness/app/profile')).toBe('/app/profile');
  });

  // The landing page says "go back to the app"; inside the app the billing reconcile is the answer.
  it('turns the hosted checkout landing into the billing screen reconcile', () => {
    expect(appPathForUrl('https://app.huddle.fitness/checkout-complete?session_id=cs_1')).toBe(
      '/app/billing?checkout=cs_1',
    );
    expect(appPathForUrl('https://app.huddle.fitness/checkout-complete?cancelled=1')).toBe('/app/billing');
  });

  it('ignores anything that is not one of our web apps', () => {
    expect(appPathForUrl('https://huddle.fitness/pricing.html')).toBeNull();
    expect(appPathForUrl('https://app.huddle.fitness.evil.test/join?i=1')).toBeNull();
    expect(appPathForUrl('http://app.huddle.fitness/join?i=1')).toBeNull();
    expect(appPathForUrl('not a url')).toBeNull();
  });

  // The landing page's "Return to the Huddle app" button, through each app's own URL scheme.
  it('routes the checkout return button to the billing reconcile, in both apps', () => {
    expect(appPathForUrl('fitness.huddle.app://checkout-complete?session_id=cs_1')).toBe(
      '/app/billing?checkout=cs_1',
    );
    expect(appPathForUrl('fitness.huddle.app.lower://checkout-complete?cancelled=1')).toBe('/app/billing');
  });

  // Anything on the phone can open a custom scheme, so it answers the one link it exists for.
  it('ignores every other path on the scheme', () => {
    expect(appPathForUrl('fitness.huddle.app://join?i=1')).toBeNull();
    expect(appPathForUrl('fitness.huddle.app://app/profile')).toBeNull();
    expect(appPathForUrl('some.other.app://checkout-complete?session_id=cs_1')).toBeNull();
  });
});

describe('appReturnUrl', () => {
  it("names the app that claims the page's host, carrying the query through", () => {
    expect(appReturnUrl('app.huddle.fitness', '?session_id=cs_1')).toBe(
      'fitness.huddle.app://checkout-complete?session_id=cs_1',
    );
    expect(appReturnUrl('app.dev.huddle.fitness', '?cancelled=1')).toBe(
      'fitness.huddle.app.lower://checkout-complete?cancelled=1',
    );
  });

  it('offers nothing where no app claims the host', () => {
    expect(appReturnUrl('localhost', '?session_id=cs_1')).toBeNull();
    expect(appReturnUrl('huddle.fitness', '')).toBeNull();
  });

  // The button goes nowhere unless the app registers the scheme it builds -- and the scheme is the
  // bundle id the Fastfile gives each variant, which is how the two apps never claim each other's.
  it('builds the scheme the app registers in Info.plist', () => {
    expect(infoPlist).toMatch(
      /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/,
    );
    expect(appReturnUrl('app.huddle.fitness', '')).toMatch(/^fitness\.huddle\.app:\/\//);
    expect(appReturnUrl('app.dev.huddle.fitness', '')).toMatch(/^fitness\.huddle\.app\.lower:\/\//);
  });
});

// The site's half of the handshake. iOS fetches /.well-known/apple-app-site-association before it
// lets the app open any link, and fails SILENTLY: if the single-page fallback answered with
// index.html instead, links would just keep opening Safari.
describe('the web host serves the link-ownership file', () => {
  it('keeps /.well-known out of the single-page fallback', () => {
    expect(webAppConfig.navigationFallback.exclude).toContain('/.well-known/*');
  });

  // Static Web Apps takes a file's Content-Type from its extension and ignores a route's
  // Content-Type header (lower served the extensionless file as application/octet-stream). So
  // the file is stored as .json and the URL Apple fetches is rewritten onto it.
  it('serves it as JSON, by rewriting the extensionless URL onto the .json file', () => {
    const route = webAppConfig.routes.find((r) => r.route === '/.well-known/apple-app-site-association');
    expect(route?.rewrite).toBe('/.well-known/apple-app-site-association.json');
  });

  // Both apps, because lower and production serve the same build; each app's entitlement decides
  // which domain it claims. A typo in the Team ID breaks every link with no error anywhere.
  // The claimed paths are the app's screens plus the two entry points emails and Stripe link to;
  // anything else (the marketing pages, /login on a laptop) stays in the browser.
  it('names both apps under the team, and claims only the app paths', () => {
    const [details] = aasa.applinks.details;
    expect(details.appIDs).toEqual(['R73HV8H48W.fitness.huddle.app', 'R73HV8H48W.fitness.huddle.app.lower']);
    expect(details.components.map((c) => c['/'])).toEqual(['/join*', '/app/*', '/checkout-complete*']);
  });

  // Password AutoFill: without both halves the app's login screen never offers the password saved
  // for the site, and nothing anywhere reports that.
  it('vouches for both apps for saved passwords too, and the app claims the same domain for them', () => {
    expect(aasa.webcredentials.apps).toEqual(['R73HV8H48W.fitness.huddle.app', 'R73HV8H48W.fitness.huddle.app.lower']);
    expect(entitlements).toContain('<string>webcredentials:$(APP_LINK_DOMAIN)</string>');
    expect(entitlements).toContain('<string>applinks:$(APP_LINK_DOMAIN)</string>');
  });
});

describe('listenForAppLinks', () => {
  // The web branch: the browser has already loaded the URL, so nothing listens at all.
  it('does nothing on the web', async () => {
    const onPath = vi.fn();
    const stop = listenForAppLinks(onPath);
    await settle();
    expect(env.addListener).not.toHaveBeenCalled();
    expect(onPath).not.toHaveBeenCalled();
    stop();
  });

  it('routes a link that opens the running app', async () => {
    env.native = true;
    const onPath = vi.fn();
    listenForAppLinks(onPath);
    await settle();
    env.listeners[0].fn({ url: 'https://app.huddle.fitness/join?i=7' });
    expect(onPath).toHaveBeenCalledWith('/join?i=7');
  });

  it('routes the link that launched the app, once even if iOS reports it twice', async () => {
    env.native = true;
    env.launchUrl = 'https://app.huddle.fitness/join?i=9';
    const onPath = vi.fn();
    listenForAppLinks(onPath);
    await settle();
    env.listeners[0].fn({ url: 'https://app.huddle.fitness/join?i=9' });
    expect(onPath).toHaveBeenCalledTimes(1);
    expect(onPath).toHaveBeenCalledWith('/join?i=9');
  });

  // Capacitor's getLaunchUrl() keeps answering with the last link that opened the app, forever. A
  // second subscription (AppLinkRouter re-running) must not route it again: after an App Store
  // checkout that was every tab tap landing back on the billing screen.
  it('routes the launch link once per launch, not once per subscription', async () => {
    env.native = true;
    env.launchUrl = 'https://app.dev.huddle.fitness/checkout-complete?session_id=cs_9';
    const first = vi.fn();
    const stopFirst = listenForAppLinks(first);
    await settle();
    stopFirst();

    const second = vi.fn();
    listenForAppLinks(second);
    await settle();

    expect(first).toHaveBeenCalledWith('/app/billing?checkout=cs_9');
    expect(second).not.toHaveBeenCalled();
    // A link that opens the app later still arrives, through the listener.
    env.listeners[1].fn({ url: 'https://app.dev.huddle.fitness/join?i=3' });
    expect(second).toHaveBeenCalledWith('/join?i=3');
  });

  it('stops listening when unmounted', async () => {
    env.native = true;
    const onPath = vi.fn();
    const stop = listenForAppLinks(onPath);
    await settle();
    stop();
    expect(env.listeners[0].remove).toHaveBeenCalled();
    env.listeners[0].fn({ url: 'https://app.huddle.fitness/app/log' });
    expect(onPath).not.toHaveBeenCalled();
  });
});
