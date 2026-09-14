import { expect, test } from '@playwright/test';
import { addMemberLogin, loginAs, registerHousehold, setBillingPlan, setMemberVisibility } from './support/auth';
import { addOwnExercise } from './support/exercises';
import { addPerson } from './support/people';

// Pro's promise -- the one printed on the pricing page -- is that a trainer's clients do not see
// each other. The backend proves the route shapes (MemberPermissionsTest); what only a browser can
// prove is that the promise holds on the surfaces a client actually looks at.
//
// Two of those, and the second is the one that was genuinely leaking:
//
//   1. The person switcher. A private client must not find a sibling there.
//   2. ⚠️ THE EXERCISE PICKER. `exercises` are ACCOUNT-scoped, not person-scoped, so hiding a
//      sibling's SESSIONS said nothing about the NAMES they created. A client who entered
//      "Rehab -- post-op shoulder" had it surface in every other client's search, which is a
//      medical disclosure the account promised not to make.
//
// The fix filters the READ and never the write: CREATE_SHARED_RESOURCE stays granted to every
// member regardless of visibility, because creating an exercise is a durable offline write and a
// 403 on one of those is terminal -- it would discard the create AND every set queued behind its
// temp id. So this spec asserts both halves: the client can still create, and the sibling still
// cannot see it.
test.describe('Pro — private clients', () => {

  test('a client does not see a sibling client', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');

    await addPerson(page, 'Sam');
    await addPerson(page, 'Alex');

    const sam = await addMemberLogin(page, request, ownerEmail, 'Sam', undefined, 'PRO');
    await addMemberLogin(page, request, ownerEmail, 'Alex', undefined, 'PRO');
    await setMemberVisibility(request, ownerEmail, false);

    await loginAs(page, sam.email, sam.password);

    // Neither the sibling client nor the trainer's own person. PersonPillBar hides itself entirely
    // below two visible people, so the whole switcher is gone rather than showing a lone chip.
    const chrome = page.locator('.app-chrome');
    await expect(chrome.getByRole('button', { name: 'Alex', exact: true })).toHaveCount(0);
    await expect(chrome.getByRole('button', { name: 'Nate', exact: true })).toHaveCount(0);

    // And their own screen is fully live -- private is not read-only.
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('button', { name: '+ Log a past workout' })).toBeEnabled();
  });

  test("a client's own exercise stays out of a sibling's catalogue", async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');

    await addPerson(page, 'Sam');
    await addPerson(page, 'Alex');

    const sam = await addMemberLogin(page, request, ownerEmail, 'Sam', undefined, 'PRO');
    const alex = await addMemberLogin(page, request, ownerEmail, 'Alex', undefined, 'PRO');
    await setMemberVisibility(request, ownerEmail, false);

    // A name no global row could collide with, and shaped like the disclosure this protects.
    const privateName = `Rehab Shoulder ${Date.now()}`;

    await loginAs(page, sam.email, sam.password);
    // The create itself must succeed: a member may always create a shared resource, private or not.
    await addOwnExercise(page, privateName);
    // Landing on the detail screen is how every other spec confirms the create actually took.
    await expect(page.getByRole('button', { name: /Log set/ })).toBeVisible();

    await loginAs(page, alex.email, alex.password);
    await page.getByPlaceholder('Search all exercises').fill(privateName);
    await expect(page.getByRole('button', { name: privateName, exact: true })).toHaveCount(0);

    // ⚠️ The positive control, and it is not optional. The assertion above passes just as happily
    // when search is broken, when the picker never rendered, or when this login landed somewhere
    // else entirely -- every one of which would make the privacy claim untested rather than true.
    await page.getByPlaceholder('Search all exercises').fill('Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Barbell Bench Press', exact: true })).toBeVisible();
  });

  test('a Plus household cannot make its members private', async ({ page, request }) => {
    const ownerEmail = await registerHousehold(page, request, 'Nate');
    await setBillingPlan(request, ownerEmail, 'PLUS');

    const configResponse = await request.get('/config.json');
    const { apiUrl } = await configResponse.json();
    const login = await request.post(`${apiUrl}/api/auth/login`, {
      data: { email: ownerEmail, password: 'password123' },
    });
    const { token } = await login.json();

    const response = await request.put(`${apiUrl}/api/account/member-visibility`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { membersSeeEveryone: false },
    });

    // 409, not 403: the owner has MANAGE_HOUSEHOLD and is the right person to ask -- the household
    // is simply on a tier that does not sell this. "You could, on Pro" and "not you" are different
    // answers and the family tiers depend on the difference. Everyone on a Plus account sees
    // everyone, and that is a promise to the family, not an unbuilt feature.
    expect(response.status()).toBe(409);
  });
});
