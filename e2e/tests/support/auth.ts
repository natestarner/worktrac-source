import { APIRequestContext, Page, expect } from '@playwright/test';

// Registration now requires confirming a 6-digit emailed code before the account exists --
// this can't read a real inbox, so it drives the same test-support endpoint the backend
// exposes only in local/lower (TestSupportController), gated by a shared-secret header
// (E2E_TEST_SUPPORT_KEY) on top of the profile restriction. The backend's API URL is
// discovered the same way the app itself does at runtime -- fetching /config.json from the
// frontend's own origin -- rather than hardcoding or requiring a second env var here.
//
// Centralized here instead of duplicated per spec file: seven spec files previously each
// carried their own near-identical copy of this register-and-assert-redirect snippet.
export async function registerHousehold(page: Page, request: APIRequestContext, personName: string): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

  await page.goto('/register');
  await page.getByPlaceholder('e.g. Alex').fill(personName);
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill('password123');
  await page.getByRole('button', { name: 'Create household' }).click();
  // Unlike the rest of this flow, register() now makes a real blocking network call to Azure
  // Communication Services (EmailService waits for the full send to complete before
  // responding) -- confirmed live 2026-07-13: Playwright's default 5s assertion timeout was
  // too tight for that round-trip's real-world latency and caused intermittent failures
  // (which sometimes passed on CI retry, ruling out a deterministic bug) against the actual
  // deployed lower environment.
  await expect(page).toHaveURL(/\/confirm-email/, { timeout: 20000 });

  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const codeResponse = await request.get(`${apiUrl}/api/auth/test/pending-code`, {
    params: { email },
    headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
  });
  const { code } = await codeResponse.json();

  await page.getByPlaceholder('123456').fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/app\/log/);

  return email;
}
