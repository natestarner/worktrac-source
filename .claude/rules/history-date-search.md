---
paths:
  - "frontend/src/utils/dateRange.js"
  - "frontend/src/utils/exerciseFilter.js"
  - "frontend/src/hooks/useExerciseFilter.js"
  - "frontend/src/components/history/HistoryTab.jsx"
  - "frontend/src/components/shared/ExerciseFilterBar.jsx"
  - "frontend/src/components/shared/DateCalendar.jsx"
  - "frontend/src/components/shared/DatePickerSheet.jsx"
---

# History's "Search by date"

The calendar button beside History's search field filters to the workouts on a chosen day. The
headers of `dateRange.js`, `DateCalendar.jsx` and `DatePickerSheet.jsx` carry the full reasoning;
these are the parts a future change can break without any test obviously pointing at why.

- **Days are local `'YYYY-MM-DD'` strings, never `Date`s.** They compare with `<`/`>`, match what
  `toLocalDateStr` produces from `startedAt`, and cannot drift a day through a UTC conversion.
  A `Date` is built only transiently, **at noon**, for month/weekday arithmetic — noon is clear of
  every DST transition. `dateRange.test.js` pins the US spring-forward and fall-back days.
- **The filter value is always a range, `{ from, to }`** — a single day is `from === to`. The
  filter, the chip label and the calendar's band all already handle multi-day ranges, and
  `selectDate`'s `'range'` mode is implemented and tested. **Offering ranges is
  `DatePickerSheet`'s `mode="range"` plus copy — don't add a second, day-shaped value beside it.**
- **A workout matches when it was going on during the searched days** — its day span
  (`exerciseFilter.js#sessionDaySpan`) *overlaps* the range. Not "starts on the day", which lost
  the second day of a workout crossing midnight, and not "either end is inside the range", which
  misses a workout enclosing a whole range.
  - An **unfinished** session (`endedAt` null) runs until now, **capped at 8h past its start**.
    The server auto-closes a stale session lazily (on the next live-session READ for that person)
    and `/history` returns `endedAt` as stored, so a forgotten workout can read "in progress" for
    weeks. Uncapped, it dotted every one of those days.
  - `endedAt` on a workout ended by tapping End is the **tap**, not the last set, so ending one
    just after midnight files it under that day too. Accepted: fixing it needs per-set timestamps
    `HistoryEntryDto` doesn't carry.
- **The calendar dots and the search share that one rule.** `HistoryTab` counts a workout on every
  day of its span. If the two ever diverge, the calendar dots a day whose search comes back empty
  (or the reverse). Change `sessionDaySpan`, never one consumer.
- **A finished workout crossing midnight names both dates in its header**
  (`"Jul 3, 11:30 PM – Jul 4, 12:40 AM"`), because the search finds it under the second day too.
- **It is a pure client-side pass over the cached `history`** — no request, no connectivity branch,
  nothing on `resilience.md`'s register. `e2e/tests/parity-history-date-search.spec.ts` runs it in
  all four modes; keep it that way if the feature ever grows a server-side search.
- **The trigger's accessible name is always `"Search by date"`**, whatever is selected, and the
  chip's controls are `"Change date, <label>"` / `"Stop filtering to <label>"`. Keep labels on
  History mutually non-containing (Playwright matches names as substrings) — `"Clear date"` lives
  only inside the picker for that reason.
- **Focus lands on the selected day (or today)** via `data-autofocus`, which `Modal` prefers over
  DOM order. Without it focus lands on "Previous month", against the WAI-ARIA date-picker pattern.

The Handbook's History section states the midnight rule — see `user-facing-help.md`.
