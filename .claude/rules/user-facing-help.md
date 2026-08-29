---
paths:
  - "backend/src/main/java/com/worktrac/backend/stats/**"
  - "backend/src/main/java/com/worktrac/backend/workoutsession/**"
  - "backend/src/main/java/com/worktrac/backend/csvimport/**"
  - "backend/src/main/java/com/worktrac/backend/export/**"
  - "frontend/src/components/trends/**"
  - "frontend/src/components/help/**"
  - "frontend/src/utils/formulas.js"
  - "frontend/src/utils/prSort.js"
  - "frontend/src/utils/restTarget.js"
  - "frontend/src/utils/exerciseDuplicates.js"
  - "frontend/src/hooks/useRequireOnline.js"
  - "frontend/src/hooks/useGatedMutation.js"
---

# The end-user handbook states these rules as fact

There is a user-facing help page — the Huddle Handbook — at
`frontend/src/components/help/HelpTab.jsx`, reachable from the account menu. It explains, in
plain English, rules that this codebase implements. **The files this rule loads for are the
ones that can silently make it wrong.**

Stale help is worse than absent help. A missing page costs a confused user; a page that
confidently states last quarter's behavior costs a user who acts on it and then files a bug
that isn't one.

## What the handbook asserts, and what invalidates it

| The handbook tells users… | It goes wrong if you change… |
|---|---|
| est. 1RM is Epley, `weight × (1 + reps ÷ 30)`, and a single rep is reported as itself | `EpleyCalculator.java`, `utils/formulas.js#epley` |
| PRs rank by est. 1RM (loaded), reps (bodyweight), seconds (holds) | `StatsService#comparableValue`, `utils/formulas.js#comparableValue`, `utils/prSort.js` |
| a workout auto-closes 8 hours after its last set | `WorkoutSessionService.AUTOCLOSE` |
| the rest timer targets 90s and freezes at 10 min | `utils/restTarget.js` |
| a line-chart dot is one session; three metrics are a best set, two are session totals | `components/trends/exerciseMetrics.js`, `weeklyMetrics.js` |
| the consistency grid is always 26 weeks and ignores the range toggle, **and that only the last 90 days of it fill in on Free** | `components/trends/**`, `SubscriptionService.FREE_HISTORY_WINDOW` |
| what Free and Pro each include, that export is free on both, and that PR detection reads the whole history even when display is clamped | `SubscriptionService` (the `isPro` derivation and the window), `billing/**`, `csvimport/ImportController` |
| exactly which actions work offline vs. need a connection | `useRequireOnline.js`, `useGatedMutation.js`, or moving a write between the two |
| import requires `Exercise` + `Date` + (`Reps` or `Duration (sec)`), and every other column's default | `csvimport/**`, `export/**` |
| adding an exercise you already have opens it instead of duplicating | `utils/exerciseDuplicates.js` |

**If your change alters a row's left-hand column, update the handbook in the same PR.** If it
doesn't, no action — this rule is not a prompt to re-read the page on every edit.

## Derive it, don't restate it

The handbook's Trends section renders its per-metric copy from `EXERCISE_METRICS[…].dotMeaning`
and `WEEKLY_METRICS[…].barMeaning` — the same constants `ChartHelp` reads, so the in-app `?` and
the handbook can never disagree. `chartHelp.test.js` already asserts every metric carries one.

**Do not replace those reads with pasted prose**, and when adding a metric, the new
`dotMeaning`/`barMeaning` is what reaches both surfaces. This is the same "one derivation, two
consumers" rule `docs/architecture/import-export.md` applies to the CSV round trip.

Prose that genuinely cannot be derived (the Epley formula, the 8-hour rule, the offline split)
is what the table above exists to catch.

## Section anchors are API

Every section is addressable as `/app/help#<section>`, and the page's own contents list depends on
those ids. They are the intended target for contextual deep-links from elsewhere in the app — the
chart `?` panels being the obvious next one. **Renaming an id breaks every link into it**, so grep
before changing one. `HelpTab.test.jsx` pins the list deliberately as a literal rather than
deriving it from the component, since a derived list would agree with any rename.

Current ids: `setup`, `people`, `logging`, `rest`, `time`, `own`, `routines`, `history`, `prs`,
`trends`, `personal`, `settings`, `data`, `offline`, `trouble`.

## The page must survive the basement

It is a route inside the app, not a link to `huddle.fitness`, specifically so it works with no
signal — `vite.config.js`'s `globPatterns` precaches every built chunk and `navigateFallback`
resolves `/app/help` offline. `offline-durability.spec.ts` cold-boots it with the network off,
which is the assertion that keeps this true.

**Do not move this content to the marketing site** (separate origin, no service worker — a dead
tap in a basement), and do not give it a runtime dependency (a fetch, a CDN asset, an image URL)
that fails offline.

It is also **eagerly imported**, like every other route in `App.jsx`. `React.lazy` would save
~6KB gzipped and cost the app its only Suspense boundary plus a second route-loading mechanism —
against `resilience.md`'s "reuse the mechanism" table. A route that must fetch a chunk is a worse
failure shape than one that cannot, even when the chunk is precached.
