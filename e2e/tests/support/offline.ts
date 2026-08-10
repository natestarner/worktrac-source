import { Page, expect } from '@playwright/test';

// Hard offline (navigator.onLine flips false) -- what `context.setOffline` drives. Distinct from
// the manual pin (see pinOfflineViaBanner below): both end up in the same elected-offline mode via
// onlineManager, but hard-offline is what a real lost connection looks like, while the pin is the
// user's own "Go offline" choice made from the connection-trouble banner.
export async function goHardOffline(page: Page) {
  await page.context().setOffline(true);
}

export async function goOnline(page: Page) {
  await page.context().setOffline(false);
}

// OfflineBanner's no-queued-writes offline message (see OfflineBanner.jsx). Present whenever
// `!online && queued === 0`.
export function offlineSavedLocallyBanner(page: Page) {
  return page.getByText(/your changes are saved on this device/i);
}

// ConnectionTroubleBanner -- the "lie-fi" signal: navigator.onLine still true, but
// reachabilityMonitor has seen enough consecutive request failures to suspect a dead connection.
export function troubleBanner(page: Page) {
  return page.getByText('Having trouble connecting.');
}

export function goOfflineButton(page: Page) {
  return page.getByRole('button', { name: 'Go offline' });
}

export async function pinOfflineViaBanner(page: Page) {
  await goOfflineButton(page).click();
}

// The OTHER way into the manual pin: the App Settings toggle, which calls pinOffline()/
// unpinOffline() directly. Unlike the banner path it needs no lie-fi to appear first and no
// reachability probe to leave, so it is the deterministic way for a harness to arrange the pinned
// state -- pinOfflineViaBanner above stays the way to test the banner's own path.
//
// Note the asymmetry this exposes, and don't "fix" it: the banner's "Go back online" gates on
// probeReachability() while this toggle does not. That gap is exactly what hid
// docs/incidents/2026-07-28-offline-banner-go-back-online.md for so long -- the Settings toggle
// always worked, so the bug only ever showed on one of the two paths.
async function openAppSettings(page: Page) {
  await page.locator('.header-bar').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'App Settings' }).click();
}

export async function pinOfflineViaSettings(page: Page) {
  await openAppSettings(page);
  await page.getByRole('button', { name: 'Offline mode On' }).click();
}

export async function unpinOfflineViaSettings(page: Page) {
  await openAppSettings(page);
  await page.getByRole('button', { name: 'Offline mode Off' }).click();
}

export function goBackOnlineButton(page: Page) {
  return page.getByRole('button', { name: 'Go back online' });
}

export async function unpinOfflineViaBanner(page: Page) {
  await goBackOnlineButton(page).click();
}

// OfflineRecoveryPrompt -- shown only while pinned, once the recovery heartbeat confirms the
// server is reachable again. Never auto-resumes; the user must tap through.
export function recoveryPrompt(page: Page) {
  return page.getByText(/you’re back online/i);
}

export function resumeSyncingButton(page: Page) {
  return page.getByRole('button', { name: 'Resume syncing' });
}

export function outboxCountText(page: Page, n: number) {
  return page.getByText(n === 1 ? '1 change waiting to sync' : `${n} changes waiting to sync`);
}

export async function waitForOutboxDrain(page: Page, timeout = 15000) {
  await expect(page.getByText(/waiting to sync/i)).toBeHidden({ timeout });
}

// The per-row state shown while a logged set is unsynced (paused, retrying, or mid-backoff) --
// see ExerciseDetail.jsx. Covers BOTH the offline and intermittent-error cases; there is no
// separate "will sync" wording anymore, only this.
export function savingRow(page: Page) {
  return page.getByText(/Saving/);
}
