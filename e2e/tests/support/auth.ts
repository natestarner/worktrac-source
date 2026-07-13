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
  await expect(page).toHaveURL(/\/confirm-email/);

  const configResponse = await request.get('/config.json');
  const { apiUrl } = await configResponse.json();
  const code = await fetchPendingCode(request, apiUrl, email);

  await page.getByPlaceholder('123456').fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page).toHaveURL(/\/app\/log/);

  return email;
}

// TestCodeCache (see TestCodeCache.java) is a plain in-memory map inside the running
// container -- register() only returns after writing to it, so a lookup immediately after
// should always find it. It's occasionally missing anyway: the lower backend scales to zero
// when idle (min-replicas 0), and Azure Container Apps can briefly route two requests to two
// different instances during a scale event, leaving the code written on an instance this GET
// doesn't land on. Retrying tolerates that transient case (confirmed live 2026-07-13 as the
// cause of an intermittent "Unexpected end of JSON input" failure) without masking a real
// bug -- if the code is genuinely never sent, this still fails after the deadline.
async function fetchPendingCode(request: APIRequestContext, apiUrl: string, email: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (true) {
    const response = await request.get(`${apiUrl}/api/auth/test/pending-code`, {
      params: { email },
      headers: { 'X-E2E-Test-Key': process.env.E2E_TEST_SUPPORT_KEY ?? '' },
    });
    if (response.ok()) {
      const { code } = await response.json();
      return code;
    }
    if (Date.now() >= deadline) {
      throw new Error(`No pending code appeared for ${email} within 10s (last status: ${response.status()})`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
