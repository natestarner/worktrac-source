import { APIRequestContext, Page, test } from '@playwright/test';
import { API_ONLY, failNetwork } from './faults';
import {
  goHardOffline,
  goOnline,
  pinOfflineViaSettings,
  unpinOfflineViaBanner,
  waitForOutboxDrain,
} from './offline';

// Runs ONE assertion body across every connectivity mode, so "this feature behaves the same
// online and offline" is a test result instead of a claim in a comment.
//
// Why this exists: every offline spec in this suite was written as "do X offline, assert an
// offline-shaped outcome, reconnect, assert it lands" -- which verifies the offline path works,
// but never that it produces the SAME result as online. Nothing anywhere asserted parity, even
// though docs/incidents/2026-07-30-editing-queued-offline-set.md explicitly claims editing a
// queued set behaves "identically in every connectivity mode". That claim had no test.
//
// See .claude/rules/resilience.md for the contract this enforces.

export type ConnectivityMode = 'online' | 'lie-fi' | 'hard-offline' | 'pinned-offline';

export const ALL_MODES: ConnectivityMode[] = ['online', 'lie-fi', 'hard-offline', 'pinned-offline'];

export interface ParityContext {
  mode: ConnectivityMode;
  // False only for 'online'. Use it to branch on things that are legitimately allowed to differ
  // (an outbox badge is visible when degraded and not when online) -- NEVER on the user-visible
  // result the parity assertion is about. If you find yourself branching the assertion itself,
  // that is the divergence this harness exists to catch.
  degraded: boolean;
}

interface ModeHandle {
  restore: () => Promise<void>;
}

// Arranges the real conditions, not an approximation of them:
//  - 'lie-fi' needs request-level fault injection (a rejected fetch). context.setOffline() cannot
//    drive it at all, and a fulfilled 5xx resets the reachability counter instead of tripping it.
//  - 'pinned-offline' is a DIFFERENT state from hard offline: the pin suspends onlineManager's
//    event listener, survives reload, and never lifts on its own. It is arranged via the App
//    Settings toggle rather than the trouble banner, because the banner path first needs three
//    consecutive request failures to make it appear -- which means performing a write, i.e. the
//    very thing the test is about. The banner's own path stays covered by intermittent-errors and
//    connectivity-transitions specs.
//
// Entering a mode may navigate (the pin routes through Settings), which is why `navigate` runs
// after this and not as part of `setup`.
async function enterMode(page: Page, mode: ConnectivityMode): Promise<ModeHandle> {
  if (mode === 'online') {
    return { restore: async () => {} };
  }

  if (mode === 'hard-offline') {
    await goHardOffline(page);
    return { restore: async () => goOnline(page) };
  }

  if (mode === 'lie-fi') {
    const fault = await failNetwork(page, API_ONLY);
    return { restore: async () => fault.stop() };
  }

  // Enter via App Settings (deterministic), but LEAVE via the offline banner's "Go back online".
  // Restore runs mid-test, with `afterReconnect` still to assert on whatever screen the flow was
  // on -- and the Settings toggle can only be reached by navigating away from it. The banner is
  // global chrome, so unpinning through it keeps the test where it was. Its probeReachability()
  // gate is satisfied here because this mode never breaks the network in the first place.
  await pinOfflineViaSettings(page);
  return { restore: async () => unpinOfflineViaBanner(page) };
}

// Every mode starts `navigate` from the Log tab, so a spec's navigation is identical across modes.
// Without this, pinned-offline would begin on App Settings (where enterMode left it) while the
// others begin wherever setup finished -- and the spec would have to know which mode it was in,
// which is the exact coupling this harness exists to remove. Uses the tab link rather than
// page.goto: client-side routing works offline, a real navigation needs the service worker, which
// `vite dev` does not register.
async function returnToLogTab(page: Page) {
  await page.getByRole('link', { name: 'Log' }).click();
}

export interface ParitySpec<T> {
  // Runs ONLINE, before the mode is entered. Registration and any server-side seeding the flow
  // needs. Takes Playwright's `request` fixture too, since registerHousehold needs it to read the
  // confirmation code back. Its return value is handed to every later phase.
  setup: (page: Page, request: APIRequestContext) => Promise<T>;
  // Runs INSIDE the mode, before `act`. Put screen navigation here, not in `setup` -- entering
  // pinned-offline routes through App Settings, so whatever screen `setup` left the app on is not
  // where it will be. Navigating while degraded is itself worth exercising.
  navigate?: (page: Page, state: T, ctx: ParityContext) => Promise<void>;
  // Runs INSIDE the mode. The user action under test.
  act: (page: Page, state: T, ctx: ParityContext) => Promise<void>;
  // Runs INSIDE the mode. MUST be mode-independent -- this is the parity claim itself.
  assert: (page: Page, state: T, ctx: ParityContext) => Promise<void>;
  // Runs after connectivity is restored and the outbox has drained. Use it to assert the write
  // actually reached the server, which is the half `assert` cannot see while degraded.
  afterReconnect?: (page: Page, state: T, ctx: ParityContext) => Promise<void>;
  modes?: ConnectivityMode[];
  // Modes where this parity claim is KNOWN to be violated today. Marked test.fixme, so the mode
  // still appears in the report as a named, expected failure instead of vanishing.
  //
  // This exists so a discovered divergence can be recorded honestly without either shipping a red
  // suite or quietly weakening the assertion until it passes -- the second being how a claimed
  // invariant ends up with a test that guards nothing, which is the situation this whole harness
  // was built to fix. A populated fixmeModes is a bug with a reproduction attached, not a licence
  // to leave it there: it belongs on the register in .claude/rules/resilience.md with a reason,
  // or it belongs fixed.
  fixmeModes?: ConnectivityMode[];
}

// Emits one test per mode, each named "<title> [<mode>]" so a failure names the mode directly.
export function forEachConnectivityMode<T>(title: string, spec: ParitySpec<T>) {
  const modes = spec.modes ?? ALL_MODES;

  for (const mode of modes) {
    test(`${title} [${mode}]`, async ({ page, request }) => {
      test.fixme(spec.fixmeModes?.includes(mode) ?? false, 'Known parity divergence in this mode');
      const ctx: ParityContext = { mode, degraded: mode !== 'online' };

      const state = await spec.setup(page, request);

      const handle = await enterMode(page, mode);
      try {
        await returnToLogTab(page);
        if (spec.navigate) await spec.navigate(page, state, ctx);
        await spec.act(page, state, ctx);
        await spec.assert(page, state, ctx);
      } finally {
        await handle.restore();
      }

      if (spec.afterReconnect) {
        await waitForOutboxDrain(page);
        await spec.afterReconnect(page, state, ctx);
      }
    });
  }
}
