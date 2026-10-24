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

import { appPathForUrl, listenForAppLinks } from './appLinks';
import webAppConfig from '../../../public/staticwebapp.config.json';
import aasaText from '../../../public/.well-known/apple-app-site-association?raw';

// Lets the adapter's async setup (dynamic import, addListener, getLaunchUrl) run to completion.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
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
});

// The site's half of the handshake. iOS fetches /.well-known/apple-app-site-association before it
// lets the app open any link, and fails SILENTLY: if the single-page fallback answered with
// index.html instead, links would just keep opening Safari.
describe('the web host serves the link-ownership file', () => {
  it('keeps /.well-known out of the single-page fallback', () => {
    expect(webAppConfig.navigationFallback.exclude).toContain('/.well-known/*');
  });

  it('serves it as JSON', () => {
    const route = webAppConfig.routes.find((r) => r.route === '/.well-known/apple-app-site-association');
    expect(route?.headers['Content-Type']).toBe('application/json');
  });

  // Both apps, because lower and production serve the same build; each app's entitlement decides
  // which domain it claims. A typo in the Team ID breaks every link with no error anywhere.
  // The claimed paths are the app's screens plus the two entry points emails and Stripe link to;
  // anything else (the marketing pages, /login on a laptop) stays in the browser.
  it('names both apps under the team, and claims only the app paths', () => {
    const [details] = JSON.parse(aasaText).applinks.details;
    expect(details.appIDs).toEqual(['R73HV8H48W.fitness.huddle.app', 'R73HV8H48W.fitness.huddle.app.lower']);
    expect(details.components.map((c) => c['/'])).toEqual(['/join*', '/app/*', '/checkout-complete*']);
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
