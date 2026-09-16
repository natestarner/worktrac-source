# `?plan=pro` was read as "no plan named", and the e2e suite agreed with itself

**Date:** 2026-09-16
**Area:** Marketing → registration → billing
**Symptom:** A trainer who clicked any CTA on `for-trainers.html`, registered, and confirmed their
email landed on **Log** — an ordinary free signup with no route to Pro — while a family who clicked
"Go Plus" on the homepage was carried to the billing screen. Nothing errored, nothing 404'd, and no
test failed.

## What happened

`marketing/for-trainers.html` shipped (PR #288) with three CTAs pointing at
`https://app.huddle.fitness/register?plan=pro`. `RegisterPage.jsx` read that parameter as:

```js
const wantsPlus = searchParams.get('plan') === 'plus';
```

`'pro'` is not `'plus'`, so `wantsPlus` was `false` — the same value it holds for somebody who
arrived at `/register` with no query string at all. The intent was discarded at the first hop, and
every downstream step behaved correctly given the input it was handed: `ConfirmEmailPage` saw no
intent, so it skipped `deferOnboarding()` and navigated to `/app/log`.

There was no failure to observe. A dropped hint and an absent hint are the same state.

## Why nothing caught it

This is the part worth keeping.

`e2e/marketing-tests/for-trainers.spec.ts` had a test named *"sends its CTAs at the Pro signup"*:

```ts
const ctas = page.getByRole('link', { name: 'Start a practice' });
await expect(ctas).toHaveCount(3);
for (const href of await ctas.evaluateAll((l) => l.map((x) => x.getAttribute('href')))) {
  expect(href).toContain('plan=pro');
}
```

That test was correct, meaningful, and passing the entire time. It asserts that the marketing page
**produces** `plan=pro`. Nothing anywhere asserted that the app **consumes** it.

The suite therefore reported full coverage of a contract whose two halves had never been checked
against each other. `billing-onboarding-order.spec.ts` did drive the equivalent journey — but only
ever with `?plan=plus`, so the one parameter value that worked was the only one exercised.

**The generalisable failure: a test that pins one end of a contract reads, in a coverage summary,
exactly like a test that pins the contract.** Any time a value is produced in one place and
interpreted in another — a query parameter, a localStorage key, an event name, a CSS class a
stylesheet has to define — asserting the producer is worth little on its own. Ask what *reads*
this, and whether anything fails if the reader stops understanding it.

(The same deploy fixed two instances of exactly this shape on the same page: `.band-soft` and
`.faq` were classes `styles.css` never defined, so they rendered unstyled while every assertion —
all about text and links — kept passing. See `.claude/rules/marketing.md`.)

## The fix

`RegisterPage` now maps the parameter through a table, and `ConfirmEmailPage` branches on "was a
plan named at all" rather than on one hardcoded value:

```js
const MARKETING_PLAN_INTENTS = new Map([['plus', 'PLUS'], ['pro', 'PRO']]);
const wantsPlan = MARKETING_PLAN_INTENTS.get(searchParams.get('plan')) ?? null;
```

A `Map`, not an object literal, because the key arrives off a URL: against a plain object
`?plan=toString` resolves to an inherited `Object.prototype` method, which is truthy and would read
as a named plan. It grants nothing either way — the parameter decides where somebody lands, never
what they are entitled to, which is derived server-side from the subscription — but a query string
reaching `Object.prototype` is not something to leave standing.

`ConfirmEmailPage` now carries the named plan onward as `/app/billing?intent=<plan>`, and
`BillingTab` scrolls its Pro card into view for `intent=pro` (the screen leads with Plus and keeps
Pro deliberately quieter below it, so a trainer would otherwise arrive looking at somebody else's
offer), then strips the parameter so a reload cannot replay the jump.

## Guards added

Each was verified to fail before the fix, not just to pass after it:

- `RegisterPage.test.jsx` — `?plan=pro` carries `wantsPlan: 'PRO'`. Against the old
  `=== 'plus'` logic this was the only failure in the file.
- `RegisterPage.test.jsx` — `?plan=toString|constructor|valueOf|hasOwnProperty` all read as no
  plan.
- `ConfirmEmailPage.test.jsx` — a `'PRO'` intent lands on billing with onboarding deferred.
- `BillingTab.test.jsx` — the scroll happens for `intent=pro`, does not for an ordinary arrival,
  and the parameter is stripped without disturbing the rest of the query string.
- `e2e/tests/billing-onboarding-order.spec.ts` — the whole journey, registration through to the
  Pro card. Against the old code it fails with `Received string: ".../app/log"`, reproducing the
  production symptom exactly.

Two of those guards were themselves wrong on the first attempt, in the way this incident is about:

- The strip test asserted on `window.location.search`, which `MemoryRouter` never touches — it
  would have passed against a completely broken strip. It now carries a second parameter and
  asserts that one survives, which proves the probe reports anything at all.
- The e2e asserted `toBeVisible()` on the Pro card, which is true of a card far below the fold. It
  is `toBeInViewport()` now; with the scroll disabled it fails with "viewport ratio 0".
