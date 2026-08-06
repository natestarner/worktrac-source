# Tagging (or adding a custom setup field to) a never-favorited/logged/noted exercise applied successfully but never showed on screen, permanently (2026-08-05)

- User report while testing the History/PRs tag feature: "tags don't show on the exercise detail
  screen right away — you have to navigate away and come back." Investigation found it was worse
  than a refresh delay: reproduced live (direct network capture) that `GET
  /api/people/{personId}/exercises` returned `[]` for the tagged exercise **both immediately after
  tagging and after navigating away and back** — the tag could never appear, no matter how long you
  waited or how many times you refetched, as long as the exercise had never been favorited, logged,
  or noted first.
- Root cause: `PersonExerciseService.listForPerson`'s picker-membership check —
  `pe.isFavorite() || (pe.getNote() != null && !pe.getNote().isBlank())`, unioned with logged
  exercises — never counted tags. A never-favorited/logged/noted exercise is sourced by the
  frontend from the account-wide catalog (`ExerciseDto`, which carries no `tags` field at all) —
  only the person-scoped list (`PersonExerciseDto`) does — so `setTags` genuinely persisted the tag
  server-side (`PUT .../tags` returned 200 with the tag in the response body), but the exercise
  never entered the one list that would let the frontend ever see it.
- `PersonExercise`'s own class-level comment was the giveaway once looked at closely: it already
  listed favorite, tags, custom fields, and note as "this person's personalization... shows in
  their picker," but the actual code only implemented that promise for two of the four. Checking
  the other `getOrCreate` call sites in the same service confirmed **custom setup fields
  (`addCustomField`) had the identical gap** — a field added to a never-favorited/logged/noted
  exercise creates a `PersonExercise` row but doesn't mark it favorite/noted either, so the
  exercise stays excluded from the picker the same way (the custom field's own *value* still
  displays correctly, since `ExerciseDetail`'s custom-fields query is fetched independently by
  personId+exerciseId rather than sourced from this list — but the exercise's overall
  discoverability in the picker is degraded the same way tags were).
- This is the exact same class of bug already fixed once for notes (see the "Exercise notes" entry
  in Data Model Notes above) — the note fix's own comment already spelled out the general principle
  ("otherwise a note set on an exercise the person hasn't favorited/logged yet is unreachable
  through the picker afterward") without it ever being generalized to tags or custom fields when
  those features shipped.
- **Takeaway:** `listForPerson`'s membership check is now `pe.isFavorite() ||
  (pe.getNote() != null && !pe.getNote().isBlank()) || !pe.getTags().isEmpty() ||
  !pe.getCustomFields().isEmpty()` — every one of the four personalization types
  `PersonExercise` can hold now puts the exercise in the picker, matching the class comment's
  original (until-now unfulfilled) promise. **Any future new per-person personalization field
  added to `PersonExercise` needs the same treatment** — the question to ask is "if someone does
  only this, with nothing else, will they ever see it again?" Covered by new tests in
  `ExerciseFavoritesTest` (`taggingAddsToThePickerEvenWithoutFavoritingOrLogging`,
  `clearingAllTagsRemovesFromPickerWhenThatWasTheOnlyReason`,
  `addingACustomFieldAddsToThePickerEvenWithoutFavoritingOrLogging`,
  `removingTheOnlyCustomFieldRemovesFromPickerWhenThatWasTheOnlyReason`) and an e2e regression
  (`history-filter.spec.ts`'s "tagging a never-logged, never-favorited exercise shows the tag
  immediately" test, which deliberately tags *before* ever logging or favoriting — the ordering
  that exposed the bug).
