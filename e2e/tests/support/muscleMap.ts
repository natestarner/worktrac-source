import { expect, type Page } from '@playwright/test';

// The muscle highlighter (the shaded body diagrams) is OFF for every new account (V102). A spec
// about the diagrams turns it on first, through the real Settings switch -- the same write and the
// same refreshed auth snapshot a person gets -- and lands back on Log.
//
// Signed in as the household OWNER: only the owner gets the switch (MANAGE_HOUSEHOLD).
export async function turnOnMuscleHighlighter(page: Page): Promise<void> {
  await page.goto('/app/settings');
  const on = page.getByRole('button', { name: 'Muscle highlighter On' });
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Log', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/log/);
}
