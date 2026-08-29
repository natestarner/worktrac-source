import { expect, test } from '@playwright/test';
import { registerHousehold, setBillingPlan } from './support/auth';
import { goHardOffline } from './support/offline';
import { forEachConnectivityMode } from './support/parity';

// The account dropdown is reached by scoping to .header-bar rather than matching the account
// holder's name, which varies per test -- the same idiom admin.spec.ts uses, and for the same
// reason. Note PlanBadge now also lives in that bar: on Free it renders a LINK and on Pro a plain
// span, so the "only button in the header" assumption those specs rely on still holds.
async function openAccountMenu(page) {
  await page.locator('.header-bar').getByRole('button').click();
}

// The claim: a household sees its own plan identically in every connectivity mode.
//
// This is the assertion that proves clamping SERVER-SIDE was the right call. The plan reaches the
// browser in the auth snapshot, and history arrives already filtered -- so there is one code path,
// and nothing about what the person sees depends on a request succeeding. The failure this guards
// against is the one the degraded-conditions contract names outright: an unreachable server
// quietly downgrading a paying household to Free.
//
// The assert body deliberately does not branch on ctx.mode. If it ever needs to, that is a real
// divergence and belongs on the register in .claude/rules/resilience.md.

forEachConnectivityMode<{ email: string }>('a Pro household reads as Pro', {
  setup: async (page, request) => {
    const email = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, email, 'PRO');
    // Reload while still online so the snapshot carries the new plan into the degraded modes.
    await page.reload();
    await expect(page.getByText('Pro', { exact: true })).toBeVisible();
    return { email };
  },
  navigate: async (page) => {
    // Client-side routing, not page.goto -- a real navigation would need the service worker, and
    // this is exercising the app rather than the SW (that lives in offline-durability.spec.ts).
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Plan & billing' }).click();
  },
  act: async () => {
    // Nothing to do: the parity claim here is about a READ. The gated WRITES have their own spec
    // below, restricted to the degraded modes, because "refuses cleanly" is not a claim that can
    // be true online.
  },
  assert: async (page) => {
    await expect(page.getByText('Huddle Pro')).toBeVisible();
    // The upgrade offer must never appear for a household that already pays -- including when the
    // subscription request cannot complete, which is exactly what three of these four modes do.
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toHaveCount(0);
    // exact:true -- "Pro" is a substring of "Profile" in the same header.
    await expect(page.getByText('Pro', { exact: true }).first()).toBeVisible();
  },
});

forEachConnectivityMode<{ email: string }>('a Free household reads as Free', {
  setup: async (page, request) => {
    const email = await registerHousehold(page, request, 'Nate');
    return { email };
  },
  navigate: async (page) => {
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Plan & billing' }).click();
  },
  act: async () => {},
  assert: async (page) => {
    // The offer is present in every mode. Whether it can be ACTED on differs by mode -- that is
    // the gate, and it is asserted separately below rather than smuggled in here, because a
    // mode-dependent assertion in this body would defeat the point of the file.
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
    await expect(page.getByText('Huddle Pro')).toHaveCount(0);
  },
});

// The gated WRITE, deliberately outside forEachConnectivityMode. "Refuses cleanly" cannot be true
// online, so it is not a parity claim -- forcing it into that shape would mean an assert body that
// branches on ctx.mode, which is precisely what the parity harness exists to forbid.
//
// Upgrading is Tier-3: not idempotent, and a payment queued in the durable outbox and replayed
// across an outage is the one thing that must never happen. So it refuses UP FRONT rather than
// failing after the fact.
test('upgrading refuses offline rather than queueing a payment', async ({ page, request }) => {
  await registerHousehold(page, request, 'Nate');
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Plan & billing' }).click();

  const upgrade = page.getByRole('button', { name: 'Upgrade to Pro' });
  await expect(upgrade).toBeEnabled();

  await goHardOffline(page);

  // OfflineDisabledWrap greys the control out up front -- the person is told before they commit,
  // rather than after a request they cannot see has failed.
  await expect(upgrade).toBeDisabled();
  // And the plan itself still reads correctly while refusing, which is the half that matters:
  // being unable to upgrade must never look like being downgraded.
  await expect(page.getByText('Free', { exact: true }).first()).toBeVisible();
});
