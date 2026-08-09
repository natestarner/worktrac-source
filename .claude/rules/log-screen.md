---
paths:
  - "frontend/src/components/log/**"
---

# Log screen (`ExerciseDetail.jsx` and friends)

The densest file in the app for cross-cutting invariants. Full narrative:
`docs/architecture/offline-mode.md` and `docs/architecture/data-model.md`.

## ⚠️ Cross-file coupling: which endpoint you call decides `rest_seconds`

`handleLogSet` picks between two backend endpoints, and that choice — not any flag — is what
determines whether `workout_sets.rest_seconds` is recorded:

- `POST /api/people/{personId}/live-sets` (real-time logging) → backend `logLiveSet` → rest time
  **is** computed.
- `POST /api/sessions/{sessionId}/sets` (explicit "editing a specific existing session" mode) →
  backend `logSetIntoSession` → rest time is **always null**.

`logSetIntoSession` is only ever called from this explicit editing mode. If that ever changes,
the backend's rest-seconds rule silently breaks — see `.claude/rules/workout-data-model.md`.

Live-set writes should carry `clientLoggedAt` so a set logged now but synced later keeps an
honest `created_at`, and therefore an honest rest gap.

## The three pending-value fallbacks — don't remove them

`contextSessionId` (`liveSession?.id || editingSessionId`) stays `null` for a person's **entire**
offline/lie-fi stretch: the placeholder `liveSession` seeded by `logSetMutation.onMutate` is
deliberately `{ id: null }` so it can never leak in, and the real id only arrives once the
create-session round trip reaches the server. Every query keyed on it (`sessionSets`,
`sessionExerciseNote`, `exerciseSummary`) is `enabled: !!contextSessionId` and never runs during
that window.

Three fallbacks close that gap:

1. **`pendingBeforeSession`** — unsynced sets, read from the log-set mutation's own variables via
   `useMutationState`.
2. **`derivedSummary`** — the "Last time"/"Best est. 1RM" card, derived from the already-warmed
   `history` cache (`utils/exerciseSummaryFromHistory.js`). Because `history` is unpaginated this
   is the *same* answer the backend would give **for everything already synced** — see the next
   section for the part it cannot see.
3. **`pendingLiveNote`** — a session note saved before/without a synced session, read from the
   pending `SAVE_NOTE` mutation's variables the same way.

`pendingLiveNote`'s "pick the newest" comparison keys off **`enqueueSeq`, not `submittedAt`** —
see `.claude/rules/offline-internals.md`.

## Anything derived from `history` must also fold in the unsynced sets on screen

`history` and `exerciseSummary` are only ever **invalidated** after a write, never optimistically
written (`queryClient.js`) — and invalidation is a no-op while a query is paused or its refetch is
failing. So a value derived from `history` alone freezes at the moment connectivity dropped, while
`displaySets` keeps growing for the rest of the offline/lie-fi stretch.

That gap put the PR pill on the **wrong row**, not merely missing: `isPrSet` asks "does this *tie*
the all-time best", so against a frozen best a genuine offline PR went unbadged while a later,
lighter set that happened to tie the *pre-offline* best got badged instead. `effectiveBest`
(`mergeBestWithLocalSets`) closes it, and both the pill and the Best card read it.

- Fold **`displaySets`**, not `sessionSets` — while offline `onMutate` writes no optimistic
  `sessionSets` row at all (that branch needs a real `contextSessionId`), so `pendingBeforeSession`
  is the only source for those rows.
- Applied in **every** connectivity mode, not gated on `isPaused`/`isError`. Folding is a `max`, so
  online it's a no-op except in the window before the post-write refetch lands.
- **Known gap:** because it's a `max` it can only ever *raise* the best. An offline **delete** or
  downward edit of an already-synced set that was the all-time best leaves the best stale-high
  until the outbox drains. Symptom is a *suppressed* badge, not a misplaced one.

**When adding any other value derived from `history`, ask:** would it be wrong for a person who has
logged sets that haven't synced yet?

## Three "is this a PR" predicates coexist on purpose — don't unify them

| Predicate | Where | Question it answers |
|---|---|---|
| strict `>` vs previous best | `WorkoutSetService#insertSetAndDetectPr` | "did this set beat my best" → the celebration |
| strict `>` running best | `historyPrFlags.js`, `StatsService#getExerciseTrend` | "was this a PR *when recorded*" → History ★, trend dots |
| `\|Δ\| < 0.5` tie with best | `formulas.js#isPrSet` | "is this my best" → the Log screen pill |

The Log pill is the odd one out **deliberately**: it marks *"this is your best"*, so a repeat of an
identical best stays flagged. The visible consequence is that hitting your best three times stars
one row on History but pills all three on Log. That is intended — **don't "fix" one into another.**
`historyPrFlags.js`'s header explains why a backend fold was rejected for History's markers.

## Editable temp rows

`editableTempIds` is what gives a paused/retrying/errored row its Edit and Delete controls
immediately instead of an indefinite "Saving…" spinner. "Saving…" is only for a write's first
in-flight attempt.
