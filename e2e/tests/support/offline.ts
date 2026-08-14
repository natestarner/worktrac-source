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

// `setOffline` does NOT survive into a document created after it -- use this when a spec reloads
// while offline.
//
// Measured on 2026-08-14 by probing both sides of one reload (Chromium 3.x, Playwright 1.5x):
//
//   live document, right after setOffline(true):  navigator.onLine === false, 'offline' event fired
//   document created by the reload that follows:  navigator.onLine === true, NO event, forever
//
// CDP's Network.emulateNetworkConditions flips the renderer's network state and fires the
// transition on documents that already exist. A document created afterwards starts life reading
// `true`, and because nothing transitioned there is no event to correct it -- so the app boots
// believing it is online while every request genuinely fails. That is lie-fi, not hard offline: a
// real device that is genuinely offline reports `false` at document creation, which is what
// offlineMode.js's applyPersistedPin() seeds onlineManager from.
//
// So this is compensating for a harness gap, NOT relaxing the assertion. `setOffline` still makes
// the requests genuinely fail; this only restores the one fact the emulation drops, so the app's
// real cold-boot path (applyPersistedPin -> onlineManager -> OfflineBanner) is what gets exercised.
// Without it, offline-durability's cold-boot spec was asserting the offline banner while the app
// was correctly rendering the lie-fi banner -- and it was misfiled for four days as a rotted test.
// See docs/incidents/2026-08-14-cold-boot-offline-spec-measured-liefi.md.
//
// Applies to every LATER navigation on this page, so call it after the online setup phase. There is
// no removing it once added, so a spec that reconnects and reloads AGAIN would keep reading
// `false` -- which is why the other three specs in offline-durability.spec.ts deliberately do not
// use it. Their reloads therefore land in lie-fi rather than hard offline; that is fine for what
// they assert (durable-outbox survival, ended-workout suppression, no permanent deadlock), none of
// which is a claim about the connectivity signal. Don't add it to them without re-checking their
// reconnect halves.
export async function keepHardOfflineAcrossReload(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
  });
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

// "Every queued write has actually reached the server" -- and the banner count alone is NOT that
// gate.
//
// useOutboxCount deliberately stops counting a write the moment it becomes a plain in-flight first
// attempt (pending, not paused, failureCount 0), so a fast online write doesn't flash the banner.
// That also means the count drops the instant resumePausedMutations() un-pauses a queued write --
// well before the request completes. A reload straight afterwards lands with the write still in the
// durable outbox, so whatever renders next came from restoreOutbox's replay rather than from server
// truth. Three of the four parity modes were passing that way, which is why
// docs/incidents/2026-08-12-provisional-live-session-restored-as-fresh.md showed up only in lie-fi
// -- the one mode whose write has failureCount > 0 and so stays counted until it genuinely succeeds.
//
// The per-row "Saving..." state is exactly the first-in-flight-attempt signal the count omits, so
// waiting out both closes the gap with no new plumbing. Do NOT "fix" useOutboxCount instead: its
// exclusion is deliberate product behaviour (see that hook's header comment).
export async function waitForOutboxDrain(page: Page, timeout = 15000) {
  await expect(page.getByText(/waiting to sync/i)).toBeHidden({ timeout });
  await expect(savingRow(page)).toBeHidden({ timeout });
}

// The per-row state shown while a logged set is unsynced (paused, retrying, or mid-backoff) --
// see ExerciseDetail.jsx. Covers BOTH the offline and intermittent-error cases; there is no
// separate "will sync" wording anymore, only this.
//
// EXACT, not /Saving/. RoutineFormModal's offline toast reads "Saving a routine needs a
// connection.", so the loose pattern matches two unrelated things -- and since waitForOutboxDrain
// now uses this on behalf of every spec that drains, a substring match would turn any future
// offline-routine test into a strict-mode violation in a helper it never knowingly called.
// The row renders `Saving&hellip;`, i.e. a real ellipsis character.
export function savingRow(page: Page) {
  return page.getByText('Saving…', { exact: true });
}
