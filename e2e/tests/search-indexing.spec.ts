import { test, expect } from '@playwright/test';

// The app origin must stay out of search results so huddle.fitness is the one result for "Huddle".
// Before 2026-10-28 /robots.txt fell through the SPA fallback and answered 200 with index.html, and
// no response said noindex. frontend/src/searchIndexing.test.js pins the config; this checks what
// the deployed Static Web App actually sends, which is the only place the header exists.

test('robots.txt is a real robots file, not the app shell', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain/);
  const body = await response.text();
  expect(body).toMatch(/^User-agent: \*$/m);
  expect(body).not.toContain('<html');
});

test('every app response says noindex', async ({ request, baseURL }) => {
  // The header comes from staticwebapp.config.json's globalHeaders, which only Azure applies; the
  // Vite dev server never sends it. Runs against lower on every deploy.
  test.skip(!!baseURL?.includes('localhost'), 'SWA response headers exist only on a deployed environment');
  for (const path of ['/', '/login', '/register']) {
    const response = await request.get(path);
    expect(response.headers()['x-robots-tag'], path).toBe('noindex');
  }
});
