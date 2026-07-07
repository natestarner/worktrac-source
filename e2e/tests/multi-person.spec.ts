import { test, expect } from '@playwright/test';

test.describe('Multi-person switching', () => {
  test('switching people and back resumes exactly where each left off', async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Alex');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    // Alex picks an exercise -- this is the "in-progress" state that should be
    // preserved when switching away and back.
    await page.getByRole('button', { name: 'Barbell Bench Press' }).click();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // Add Sam and switch to them.
    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Newly added person becomes active, and starts with no exercise selected.
    await expect(page.getByPlaceholder('Search exercises')).toBeVisible();

    // Switch back to Alex -- should return to Barbell Bench Press, not the picker.
    await page.getByRole('button', { name: /Alex/ }).click();
    await expect(page.getByRole('button', { name: 'Log set' })).toBeVisible();

    // Switch to Sam again -- still no exercise selected for them.
    await page.getByRole('button', { name: /Sam/ }).click();
    await expect(page.getByPlaceholder('Search exercises')).toBeVisible();
  });

  test('switching people preserves which tab each person was viewing', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Alex');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Sam navigates to Routines while active.
    await page.getByRole('link', { name: 'Routines' }).click();
    await expect(page).toHaveURL(/\/app\/routines/);

    // Switch to Alex -- Alex was last on Log (never navigated away), not Routines.
    await page.getByRole('button', { name: /Alex/ }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    // Alex browses to History.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/app\/history/);

    // Switching back to Sam must resume Sam's own last tab (Routines), not whichever
    // tab was showing most recently overall (Alex's History).
    await page.getByRole('button', { name: /Sam/ }).click();
    await expect(page).toHaveURL(/\/app\/routines/);

    // And switching back to Alex resumes Alex's own last tab (History).
    await page.getByRole('button', { name: /Alex/ }).click();
    await expect(page).toHaveURL(/\/app\/history/);
  });

  test('switching people away from an in-progress past-session edit and back resumes it', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Alex');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Alex starts logging a past workout.
    await page.getByRole('button', { name: /Alex/ }).click();
    await page.getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: '+ Log a past workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start adding sets' }).click();
    await expect(page).toHaveURL(/\/app\/log/);
    await expect(page.getByText('Editing past session')).toBeVisible();

    // Switch away to Sam, then back to Alex -- Alex must still be editing that same
    // past session, not dropped back to normal live logging.
    await page.getByRole('button', { name: /Sam/ }).click();
    await page.getByRole('button', { name: /Alex/ }).click();
    await expect(page.getByText('Editing past session')).toBeVisible();
  });

  test('each person has their own independent rest timer', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Alex');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    // Alex logs a set -- starts Alex's own rest timer.
    await page.getByRole('button', { name: /Alex/ }).click();
    await page.getByRole('button', { name: 'Barbell Bench Press' }).click();
    await page.getByRole('button', { name: 'Log set' }).click();
    await expect(page.getByText('New PR!')).toBeVisible({ timeout: 5000 });
    await page.getByText('New PR!').click({ force: true });
    await expect(page.getByText('Rest')).toBeVisible();

    // Sam has never logged anything -- switching to Sam must NOT show Alex's timer.
    await page.getByRole('button', { name: /Sam/ }).click();
    await expect(page.getByText('Rest')).toHaveCount(0);

    // Switching back to Alex, their timer is still running (not reset or destroyed by
    // having switched away).
    await page.getByRole('button', { name: /Alex/ }).click();
    await expect(page.getByText('Rest')).toBeVisible();
  });

  test('switching people preserves a half-typed exercise search', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    await page.goto('/register');
    await page.getByPlaceholder('e.g. Alex').fill('Alex');
    await page.getByPlaceholder('you@example.com').fill(email);
    await page.getByPlaceholder('At least 8 characters').fill('password123');
    await page.getByRole('button', { name: 'Create household' }).click();
    await expect(page).toHaveURL(/\/app\/log/);

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.getByPlaceholder('Name', { exact: true }).fill('Sam');
    await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

    await page.getByRole('button', { name: /Alex/ }).click();
    await page.getByPlaceholder('Search exercises').fill('bench');

    // Sam's search box starts empty, unaffected by Alex's search.
    await page.getByRole('button', { name: /Sam/ }).click();
    await expect(page.getByPlaceholder('Search exercises')).toHaveValue('');

    // Switching back to Alex restores what they'd typed.
    await page.getByRole('button', { name: /Alex/ }).click();
    await expect(page.getByPlaceholder('Search exercises')).toHaveValue('bench');
  });
});
