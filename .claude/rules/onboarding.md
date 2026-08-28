---
paths:
  - "frontend/src/components/onboarding/**"
  - "frontend/src/lib/onboardingPending.js"
  - "frontend/src/lib/focusTrap.js"
  - "frontend/src/lib/bodyScrollLock.js"
  - "frontend/src/components/shared/Modal.jsx"
---

# First-run guided tour

Nine-step driven-spotlight tour (`components/onboarding/`) + a welcome modal shown once on a
brand-new registration. Full design narrative lives in the plan this shipped from; the invariants
below are what a future change must not break. Each file's own header comment carries the
reasoning — read those before changing the mechanism, not just this list.

## The contract a future change must not break

- **`data-tour-anchor` values are shared, not duplicated.** Every component carrying one imports
  its value from `TOUR_ANCHORS` (`tourSteps.js`) rather than typing the string. A typo in either
  place is a *silent* no-spotlight with no error — `tourSteps.test.js` catches a stale `TOUR_STEPS`
  entry, and each carrying component's own test asserts its attribute is still present, but nothing
  catches a typo made in both places at once. Removing an attribute from one of the six carrying
  components (`TabsNav`, `PersonPillBar`, `ExercisePicker` x2, `ExerciseDetail` x3, `RoutinesTab`,
  `UserMenu`) silently degrades that step to the missing-anchor centred fallback — not a crash, so
  it won't page anyone.
- **`Modal.jsx` and `ProductTour.jsx` share `lib/focusTrap.js` / `lib/bodyScrollLock.js`.** Do not
  fork a second copy of either for a future overlay. If a third overlay needs the identical
  Tab-trap or scroll-lock, it reuses these two modules too.
- **Runtime state (`tour: { stepIndex } | null`) lives in `UIContext`, never `AppStateContext`.**
  Onboarding belongs to the account, not to whichever person is active — `AppStateContext.byPerson`
  would fork it on a person switch and (via `PERSON_DEFAULTS`) turn it into a persisted-schema
  change for state that must never persist across a reload.
- **The exercise-restore and `setDraft` calls in `ProductTour`'s exit handler (`finishOrSkip`) are
  dispatched together, in that order, every time.** Splitting them (or reordering `setExerciseSearch`
  before the exercise restore) reopens exactly the prefill-stomping bug in
  `docs/incidents/2026-08-12-prefill-overwrites-typed-weight.md` — `SELECT_EXERCISE` clears
  `exerciseSearch` as a side effect, so the search restore has to happen *after*.
  `ProductTour.test.jsx`'s restore tests pin all six draft fields, the exercise, and the pathname
  together for this reason.
- **The welcome flag (`lib/onboardingPending.js`) is armed only in `AuthContext.confirmEmail`,
  never `login`.** `confirmEmail` is the only path where the account is provably created in the
  same request; `login` runs on every ordinary sign-in an account will ever do.
- **`e2e/tests/support/auth.ts`'s `registerHousehold` dismisses the welcome modal
  unconditionally** (a `.click()`, not an `isVisible()` check) because it runs before all ~149
  other e2e call sites. Don't make that conditional — see the function's own comment for the
  actionability-wait race a conditional check would reintroduce.
- **The tour's own screen-arrangement is declarative** (`TOUR_STEPS[i].screen`), applied by one
  effect keyed on the step. Don't add an imperative branch for a new step — declarative is what
  makes stepping backward re-arrange for free.
- No branch in this feature reads `useOnlineStatus` or awaits a fetch to decide whether to
  render a step. `parity-onboarding-tour.spec.ts` exists specifically to catch that regression —
  see `.claude/rules/resilience.md`'s mechanism table before adding one.
