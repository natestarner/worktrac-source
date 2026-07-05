import { test, expect } from '@playwright/test';

// Placeholder smoke test — the app has no real pages yet (pipeline was set up
// before the workout-tracking UI). Replace/expand this once real pages exist.
test.describe('Smoke', () => {
  test('homepage responds', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });
});
