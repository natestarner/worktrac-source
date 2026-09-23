import { APIRequestContext, expect } from '@playwright/test';
import { registerHousehold } from './support/auth';
import { dismissPrCelebration, pickExercise } from './support/exercises';
import { holdNetwork } from './support/faults';
import { forEachConnectivityMode } from './support/parity';

// Ending a workout while its FIRST set is still saving must end that workout -- on screen, not
// just on the server. docs/incidents/2026-09-23-end-workout-mid-save-resurrected.md
//
// While the first set is in flight the live session is the client's `{ id: null }` placeholder,
// so there is no id to record as ended. The set's create then lands, and its response wrote the
// new session back as LIVE -- with the end-workout still queued behind it in the serial outbox.
// Until something refetched the live session after the end landed, the ended workout was the
// live one, and whatever was logged next was shown as part of it ("Set 2" on a first set). Online
// that lasted about a round trip; degraded, nothing can refetch, so it lasted the whole outage.
// Lower hit it on parity-pr-celebration's setup, which logs a first set and ends straight away.
//
// Both holds below let the requests through for real; they only pin the ORDER the flaky version
// left to chance: the create lands, the end has not. The end stays held through `assert`, which
// is what makes this deterministic in every mode, online included.
type State = { email: string; heldEnd: Awaited<ReturnType<typeof holdNetwork>> };

forEachConnectivityMode<State>('ending a workout mid-save ends it, and the next workout starts clean', {
  setup: async (page, request) => {
    const email = await registerHousehold(page, request, 'Mids');
    await pickExercise(page, 'Barbell Bench Press');

    // Held too, until End is confirmed. The `{ id: null }` placeholder always revalidates
    // (useLiveSession's staleTime), and while the create is held the server truthfully answers
    // "no live session" -- which takes the session bar, and the End dialog with it, off screen. On
    // lower the End tap landed inside that read's round trip (the 204 was still in flight at the
    // confirm); holding it pins the same order.
    const heldLiveRead = await holdNetwork(page, /\/api\/people\/\d+\/sessions\/live$/);
    const heldCreate = await holdNetwork(page, /\/api\/people\/\d+\/live-sets$/);
    await page.getByRole('button', { name: 'Log set' }).click();
    // A first-ever set always takes a record, and the overlay is decided on the device, so it is up
    // while the create is still held. Waited for explicitly: dismissPrCelebration only checks, and
    // an overlay that arrives a beat later sits animating over the End confirm.
    const celebration = page.getByText('New PR!');
    await expect(celebration).toBeVisible();
    await celebration.click({ force: true });
    await expect(celebration).toBeHidden();
    await expect.poll(() => heldCreate.held()).toBe(1);

    const heldEnd = await holdNetwork(page, /\/api\/people\/\d+\/sessions\/live\/end$/);
    await page.getByRole('button', { name: 'End workout' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End workout' }).click();
    heldLiveRead.release();

    const createLanded = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/people\/\d+\/live-sets$/.test(r.url()) && r.ok(),
    );
    heldCreate.release();
    await createLanded;
    // The end-workout is next in the serial outbox, so it is sent as soon as the create settles.
    await expect.poll(() => heldEnd.held()).toBe(1);
    return { email, heldEnd };
  },

  navigate: async (page) => {
    // Ending from the exercise screen returns to the picker, but not necessarily in every mode's
    // timing -- go through the picker either way.
    const back = page.getByRole('button', { name: /All exercises/ });
    if (await back.isVisible()) await back.click();
    await pickExercise(page, 'Barbell Bench Press');
  },

  act: async (page) => {
    await page.getByRole('button', { name: 'Log set' }).click();
    await dismissPrCelebration(page);
  },

  // A new workout: exactly one set, and it is IN PROGRESS (banner up). Before the fix the ended
  // workout was still the live one, so this read "Set 1, Set 2". The banner half catches the
  // opposite mistake -- hiding the ended session but leaving no placeholder for the new one.
  assert: async (page, { heldEnd }) => {
    await expect(page.getByText(/^Set \d+$/)).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Workout session' })).toBeVisible();
    heldEnd.release();
  },

  // Server truth: the first workout ended with its one set, and the second set is a workout of its
  // own. Read through the API, not the screen, so no client cache can answer for it.
  afterReconnect: async (_page, { email }, _ctx) => {
    const request = _page.request;
    await expect.poll(() => workoutsOnServer(request, email)).toEqual([
      { ended: false, sets: 1 },
      { ended: true, sets: 1 },
    ]);
  },
});

async function workoutsOnServer(request: APIRequestContext, email: string) {
  const { apiUrl } = await (await request.get('/config.json')).json();
  const login = await request.post(`${apiUrl}/api/auth/login`, { data: { email, password: 'password123' } });
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const me = await (await request.get(`${apiUrl}/api/auth/me`, { headers })).json();
  const history = await (await request.get(`${apiUrl}/api/people/${me.people[0].id}/history`, { headers })).json();
  return history.map((session: { endedAt: string | null; entries: { sets: unknown[] }[] }) => ({
    ended: session.endedAt !== null,
    sets: session.entries.reduce((n, entry) => n + entry.sets.length, 0),
  }));
}
