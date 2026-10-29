import { describe, expect, it } from 'vitest';
import webAppConfig from '../public/staticwebapp.config.json';
import robots from '../public/robots.txt?raw';

// The app origin must stay out of search results: huddle.fitness (marketing/) is the page meant to
// rank for "Huddle". Before 2026-10-28 /robots.txt fell through the SPA fallback and answered 200
// with index.html, and nothing said noindex, so every app route could be indexed as a thin page
// titled "Huddle". Response headers only exist on a deployed Static Web App, so the config is
// what can be pinned here.
describe('app origin search indexing', () => {
  it('sends noindex on every response', () => {
    expect(webAppConfig.globalHeaders['X-Robots-Tag']).toBe('noindex');
  });

  it('serves the real robots.txt rather than the app shell', () => {
    expect(webAppConfig.navigationFallback.exclude).toContain('/robots.txt');
  });

  // A Disallow would stop crawlers fetching pages at all, so they would never see the noindex,
  // and app URLs they already knew would stay indexed as bare links.
  it('lets crawlers in, so they can read the noindex', () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
  });
});
